import { NextResponse } from "next/server";
import { dueCallbackLeadIds } from "@/lib/db/callbacks";
import { reserveCallWorkItems } from "@/lib/db/opportunities";
import { getScope } from "@/lib/db/scope";
import { claimDialLeads, RESERVATION_TTL_SEC } from "@/lib/db/reservations";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Atomically claim the next N dial-eligible leads for the signed-in rep —
 * never-dialed first, DNC-scrubbed, skipping anything another rep (or the AI
 * cron) currently holds. This replaces "slice a client-side array" as the way
 * the dialer decides who gets dialed: two workers can no longer pick the same
 * lead, because a claim is exclusive by construction.
 *
 * The claim expires after `ttlSeconds` unless renewed (/api/dialer/heartbeat)
 * or consumed by a dial; skipping releases it (/api/dialer/release).
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const scope = await getScope();
  if (!scope?.orgId || !scope.userId) {
    return NextResponse.json({ leads: [], ttlSeconds: RESERVATION_TTL_SEC });
  }
  const rl = rateLimit(`claim:${scope.userId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    count?: number;
    statuses?: string[];
    campaignId?: string;
    packId?: string;
    leadIds?: string[];
    /** Claim in leadIds LIST ORDER (the dialer's queue-fidelity mode). */
    preserveOrder?: boolean;
  };

  // Org-wide dial policy (Admin → Dialing): a max-attempts ceiling and a
  // re-dial cooldown, both 0 (off) unless the admin set them.
  const dialing = viewer.org?.settings.dialing;
  const maxAttempts = Math.max(0, Math.round(Number(dialing?.maxAttemptsPerLead) || 0));
  const cooldownMinutes = Math.max(0, Math.round(Number(dialing?.redialCooldownMin) || 0));
  const limit = Math.min(Math.max(1, Math.round(body.count ?? 1)), 10);
  const base = {
    orgId: scope.orgId,
    userId: scope.userId,
    supervisor: scope.supervisor,
    statuses: Array.isArray(body.statuses) ? body.statuses.slice(0, 12) : [],
    campaignId: typeof body.campaignId === "string" ? body.campaignId : null,
    packId: typeof body.packId === "string" ? body.packId : null,
  };
  const explicitIds = Array.isArray(body.leadIds) ? body.leadIds.slice(0, 200) : null;

  // The claim RPC applies the pacing knobs unconditionally, but the eligibility
  // contract (docs/phase-1/architecture-and-data-contracts.md + the TS twin)
  // promises a DUE CALLBACK bypasses cooldown/max-attempts — a "call me back
  // in 30 minutes" promise must not be silently starved by the org's re-dial
  // cooldown. So due-callback leads are claimed FIRST with the knobs off, and
  // the general claim fills the remainder with the knobs on. When the caller
  // sent an explicit list (strict queue-fidelity mode — the DEFAULT for every
  // dial now), the bypass set is the INTERSECTION dueIds ∩ leadIds: the
  // callback promise survives the knobs, but the claim still never leaves the
  // rep's loaded list. DNC and the calling window are enforced inside the
  // claim either way.
  const leads = [] as Awaited<ReturnType<typeof claimDialLeads>>;
  if (maxAttempts > 0 || cooldownMinutes > 0) {
    const dueIds = await dueCallbackLeadIds(scope.orgId);
    const bypassIds = explicitIds
      ? explicitIds.filter((id) => dueIds.includes(id))
      : dueIds;
    if (bypassIds.length) {
      leads.push(
        ...(await claimDialLeads({
          ...base,
          limit,
          leadIds: bypassIds,
          // Keep the rep's order when the list came from the rep.
          preserveOrder: Boolean(explicitIds && body.preserveOrder),
        })),
      );
    }
  }
  if (leads.length < limit) {
    const claimedIds = new Set(leads.map((l) => l.id));
    const rest = await claimDialLeads({
      ...base,
      limit: limit - leads.length,
      leadIds: explicitIds,
      preserveOrder: Boolean(body.preserveOrder),
      maxAttempts,
      cooldownMinutes,
    });
    leads.push(...rest.filter((l) => !claimedIds.has(l.id)));
  }

  // P2.3 threading: the call work items behind the claimed leads get reserved
  // for this rep, so the disposition completes the item that was actually
  // worked. Fire-and-forget — Phase 2 bookkeeping never slows a claim.
  if (leads.length) {
    void reserveCallWorkItems({
      orgId: scope.orgId,
      leadIds: leads.map((l) => l.id),
      repId: scope.userId,
      ttlSeconds: RESERVATION_TTL_SEC,
    });
  }
  return NextResponse.json({ leads, ttlSeconds: RESERVATION_TTL_SEC });
}
