import { NextResponse } from "next/server";
import { breakerStatus } from "@/lib/ai-call-breaker";
import { placeAiCallForLead } from "@/lib/ai-dialer";
import {
  sanitizeDialingPolicy,
  sanitizeRetryPolicy,
  type CampaignDialingMode,
} from "@/lib/campaign-policy";
import { touchLeadContacted } from "@/lib/db/leads";
import {
  claimDialLeads,
  markLeadAttempted,
  releaseDialLeads,
  SYSTEM_RESERVER,
} from "@/lib/db/reservations";
import { nextDialSeq } from "@/lib/dialer/rotation-server";
import { zonedDayKey } from "@/lib/dialer/schedule";
import { fetchQuota, isElevenLabsConfigured } from "@/lib/elevenlabs";
import { listActiveOrgsWithSettings } from "@/lib/org/membership";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getPublicBaseUrl } from "@/lib/twilio";

/** Guard the batched campaign read: campaign_id is TEXT on leads, and one
 *  non-uuid value in an `.in()` list would fail the WHOLE policy query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * campaign id → the slice of its policy this cron enforces. One batched read
 * per org tick; campaigns without any policy simply aren't in the map. A
 * failed read FAILS OPEN (empty map): the org's own automation rules were
 * already enforced by the claim, so worst case a campaign preference is
 * skipped for one tick — better than the whole run halting.
 */
async function campaignPolicies(
  orgId: string,
  campaignIds: (string | undefined)[],
): Promise<Map<string, { modes: CampaignDialingMode[]; cooldownHours: number }>> {
  const out = new Map<string, { modes: CampaignDialingMode[]; cooldownHours: number }>();
  const ids = [...new Set(campaignIds.filter((id): id is string => Boolean(id && UUID_RE.test(id))))];
  if (!ids.length || !isAdminConfigured()) return out;
  try {
    const { data } = await createAdminClient()
      .from("campaigns")
      .select("id,dialing_policy,retry_policy")
      .eq("org_id", orgId)
      .in("id", ids.slice(0, 200));
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const dp = sanitizeDialingPolicy(r.dialing_policy);
      const rp = sanitizeRetryPolicy(r.retry_policy);
      if (!dp && !rp) continue;
      out.set(String(r.id), {
        modes: dp?.modes ?? [],
        cooldownHours: rp?.cooldownHours ?? 0,
      });
    }
  } catch {
    /* fail open — org-level rules still hold */
  }
  return out;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Unattended AI auto-dialer. A scheduler (Vercel Cron, or any external cron)
 * hits this every minute. For each active org with automation enabled, it places
 * up to `callsPerRun` AI calls to the org's least-recently-contacted dialable
 * leads WHOSE OWN LOCAL TIME is inside the configured calling window (TCPA is
 * evaluated per-lead, in the called party's timezone — not the org's), honoring a
 * per-day cap and a per-lead cooldown so the same person isn't dialed twice.
 *
 * Security: requires `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends
 * this automatically when the CRON_SECRET env var is set; external schedulers
 * must add the header themselves. With no secret configured we refuse to run.
 */
async function runAutoDial(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set — refusing to run the auto-dialer." },
      { status: 503 },
    );
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Without the AI agent there's nothing to place calls with.
  if (!isElevenLabsConfigured()) {
    return NextResponse.json({ ok: true, skipped: "ElevenLabs not configured", results: [] });
  }

  // PRE-FLIGHT: never start an unattended run against a dead provider.
  //
  // The loop below stamps a lead as contacted BEFORE placing its call (so a
  // mid-flight crash can't cause a re-dial loop). That's right when calls work —
  // but if the account is out of credits, every lead it touches gets marked
  // contacted while the provider hangs up on them mid-greeting. Unattended, at
  // one tick per minute, that quietly burns the whole book overnight. So we check
  // the balance once, up front, and refuse to start.
  const quota = await fetchQuota({ force: true });
  if (quota?.exhausted) {
    console.error("[cron.auto-dial] halted — out of ElevenLabs credits", quota);
    return NextResponse.json({
      ok: false,
      halted: true,
      reason: "provider_quota_exceeded",
      error: "Out of ElevenLabs credits — auto-dialing halted so it stops burning leads.",
      quota,
    });
  }
  const breaker = breakerStatus();
  if (breaker.open) {
    return NextResponse.json({
      ok: false,
      halted: true,
      reason: breaker.reason,
      error: `Auto-dialing halted: ${breaker.message}`,
    });
  }

  const now = new Date();
  const baseUrl = getPublicBaseUrl(req);
  const orgs = await listActiveOrgsWithSettings();
  const results: Array<Record<string, unknown>> = [];
  let halted: string | null = null;

  for (const org of orgs) {
    const a = org.settings.automation;
    // Master switch + a configured window. The window HOURS are now checked
    // per-lead below (in each lead's own timezone), not once in the org's — TCPA
    // governs the called party's local time, so a Central-time org must not dial a
    // California lead at 6am PT just because it's 8am in the org's zone.
    if (!a?.enabled || !Array.isArray(a.windows) || a.windows.length === 0) continue;
    // Respect the AI-agent feature flag (premium / plan gate).
    if (!org.settings.features.aiAgent) {
      results.push({ org: org.name, skipped: "aiAgent disabled" });
      continue;
    }

    const dayKey = `auto:${org.id}:${zonedDayKey(now, a.timezone)}`;
    // CLAIM a candidate pool (larger than callsPerRun) through the reservation
    // engine — the same atomic path the manual dialer uses, so this cron can no
    // longer race a rep onto the same lead. Never-dialed leads come first by
    // construction; DNC + cooldown are enforced inside the claim; the per-lead
    // local calling window (TCPA follows the CALLED party's clock) is
    // re-checked in TS and out-of-window leads are auto-released.
    const poolSize = Math.min(Math.max(a.callsPerRun * 10, 30), 200);
    const reserver = org.ownerId ?? SYSTEM_RESERVER;
    const leads = await claimDialLeads({
      orgId: org.id,
      userId: reserver,
      supervisor: true,
      limit: poolSize,
      ttlSeconds: 300,
      cooldownMinutes: Math.max(0, a.cooldownHours) * 60,
      window: a,
      now,
    });
    if (!leads.length) {
      results.push({ org: org.name, placed: 0, note: "no eligible leads in-window" });
      continue;
    }

    // ── CAMPAIGN POLICY SEAM (Phase 1 · D4) ─────────────────────────────────
    // The claim above is ORG-wide; a campaign can only narrow it. For claimed
    // leads that belong to a campaign with a dialing/retry policy:
    //  • dialing_policy.modes excluding "ai" ⇒ this cron must not touch the
    //    lead — release it immediately for the manual dialer.
    //  • retry_policy.cooldownHours LONGER than the org's ⇒ re-check the
    //    lead's last contact against the campaign's own gate and release it
    //    while still cooling. (The claim already enforced the org cooldown.)
    // Per-campaign maxAttempts renders as "exhausted" in the campaign funnel;
    // enforcing it at claim time stays with the org-wide p_max_attempts knob.
    const policies = await campaignPolicies(org.id, leads.map((l) => l.campaignId));
    const blockedIds: string[] = [];
    const dialable = leads.filter((lead) => {
      const p = lead.campaignId ? policies.get(lead.campaignId) : undefined;
      if (!p) return true;
      const aiAllowed = p.modes.length === 0 || p.modes.includes("ai");
      const cooldownMs = p.cooldownHours * 3_600_000;
      const cooling =
        cooldownMs > 0 &&
        Boolean(lead.lastContactedAt) &&
        now.getTime() - Date.parse(lead.lastContactedAt as string) < cooldownMs;
      if (aiAllowed && !cooling) return true;
      blockedIds.push(lead.id);
      return false;
    });
    if (blockedIds.length) await releaseDialLeads(org.id, reserver, blockedIds);
    if (!dialable.length) {
      results.push({ org: org.name, placed: 0, note: "campaign policy excluded all claims" });
      continue;
    }

    let placed = 0;
    let capped = false;
    for (const lead of dialable) {
      if (placed >= a.callsPerRun) break;
      // Atomic per-day cap — the counter key embeds the org's local day, so it
      // resets every morning without a cleanup job.
      if (a.dailyCap > 0) {
        const seq = await nextDialSeq(dayKey);
        if (seq > a.dailyCap) {
          capped = true;
          break;
        }
      }
      // Stamp contacted BEFORE placing so a mid-flight error can't cause a
      // re-dial loop on the next tick; disposition/webhook updates status later.
      // markLeadAttempted additionally bumps attempt_count, sets the
      // next-eligible gate, and releases this lead's reservation in one shot.
      await touchLeadContacted(org.id, lead.id, now.toISOString());
      // The next-eligible gate honors the STRICTER of the org's and the
      // lead's campaign's cooldown, so a long campaign cooldown holds even
      // though the claim itself only knows the org-wide one.
      const campaignCooldownH = lead.campaignId
        ? (policies.get(lead.campaignId)?.cooldownHours ?? 0)
        : 0;
      await markLeadAttempted(org.id, lead.id, {
        cooldownMinutes: Math.max(0, a.cooldownHours, campaignCooldownH) * 60,
        at: now,
      });
      const r = await placeAiCallForLead({
        org,
        // Stable, DB-backed rotation counter key for the org (owner id may be
        // null; a per-org key keeps caller-ID rotation advancing across ticks).
        repUserId: org.ownerId ?? `org:${org.id}`,
        lead,
        baseUrl,
        dialMode: "ai_cron",
      });
      // The provider refused mid-run (credits ran dry between ticks). Stop the
      // ENTIRE run, not just this org — the quota is account-wide, so every
      // remaining call would fail identically and spend a real homeowner.
      if (r.halted) {
        halted = r.haltReason ?? "provider_error";
        results.push({ org: org.name, lead: lead.id, halted: true, error: r.error });
        break;
      }
      placed++;
      if (r.error) results.push({ org: org.name, lead: lead.id, error: r.error });
    }
    // Release the claims we didn't consume this tick (leads beyond
    // callsPerRun/the daily cap, or everything after a mid-run halt) so
    // interactive dialers aren't blocked for the TTL. Campaign-blocked leads
    // were already released above, so this walks the dialable set only.
    const dialedIds = new Set(dialable.slice(0, placed + (halted ? 1 : 0)).map((l) => l.id));
    const leftover = dialable.filter((l) => !dialedIds.has(l.id)).map((l) => l.id);
    if (leftover.length) await releaseDialLeads(org.id, reserver, leftover);

    results.push({ org: org.name, placed, ...(capped ? { capped: true } : {}) });
    if (halted) break;
  }

  return NextResponse.json({
    ok: !halted,
    ...(halted ? { halted: true, reason: halted } : {}),
    ranAt: now.toISOString(),
    results,
  });
}

// Vercel Cron issues a GET; support POST too for external schedulers / testing.
export const GET = runAutoDial;
export const POST = runAutoDial;
