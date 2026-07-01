import { NextResponse } from "next/server";
import { placeAiCallForLead } from "@/lib/ai-dialer";
import { getAutoDialLeadsForOrg, touchLeadContacted } from "@/lib/db/leads";
import { nextDialSeq } from "@/lib/dialer/rotation-server";
import { isAutoDialActive, zonedDayKey } from "@/lib/dialer/schedule";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { listActiveOrgsWithSettings } from "@/lib/org/membership";
import { getPublicBaseUrl } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Unattended AI auto-dialer. A scheduler (Vercel Cron, or any external cron)
 * hits this every minute. For each active org whose automation window is open
 * right now (in the org's own timezone), it places up to `callsPerRun` AI calls
 * to the org's least-recently-contacted dialable leads, honoring a per-day cap
 * and a per-lead cooldown so the same person isn't dialed twice.
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

  const now = new Date();
  const baseUrl = getPublicBaseUrl(req);
  const orgs = await listActiveOrgsWithSettings();
  const results: Array<Record<string, unknown>> = [];

  for (const org of orgs) {
    const a = org.settings.automation;
    if (!isAutoDialActive(now, a)) continue;
    // Respect the AI-agent feature flag (premium / plan gate).
    if (!org.settings.features.aiAgent) {
      results.push({ org: org.name, skipped: "aiAgent disabled" });
      continue;
    }

    const dayKey = `auto:${org.id}:${zonedDayKey(now, a.timezone)}`;
    const leads = await getAutoDialLeadsForOrg(org.id, {
      cooldownHours: a.cooldownHours,
      limit: a.callsPerRun,
    });
    if (!leads.length) {
      results.push({ org: org.name, placed: 0, note: "no eligible leads" });
      continue;
    }

    let placed = 0;
    let capped = false;
    for (const lead of leads) {
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
      await touchLeadContacted(org.id, lead.id, now.toISOString());
      const r = await placeAiCallForLead({
        org,
        // Stable, DB-backed rotation counter key for the org (owner id may be
        // null; a per-org key keeps caller-ID rotation advancing across ticks).
        repUserId: org.ownerId ?? `org:${org.id}`,
        lead,
        baseUrl,
      });
      placed++;
      if (r.error) results.push({ org: org.name, lead: lead.id, error: r.error });
    }
    results.push({ org: org.name, placed, ...(capped ? { capped: true } : {}) });
  }

  return NextResponse.json({ ok: true, ranAt: now.toISOString(), results });
}

// Vercel Cron issues a GET; support POST too for external schedulers / testing.
export const GET = runAutoDial;
export const POST = runAutoDial;
