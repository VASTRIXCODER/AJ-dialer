import { NextResponse } from "next/server";
import { dueCallbackLeadIds } from "@/lib/db/callbacks";
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
  // the general pool fills the remainder with the knobs on. DNC and the
  // calling window are enforced inside the claim either way.
  const leads = [] as Awaited<ReturnType<typeof claimDialLeads>>;
  if ((maxAttempts > 0 || cooldownMinutes > 0) && !explicitIds) {
    const dueIds = await dueCallbackLeadIds(scope.orgId);
    if (dueIds.length) {
      leads.push(
        ...(await claimDialLeads({ ...base, limit, leadIds: dueIds })),
      );
    }
  }
  if (leads.length < limit) {
    const claimedIds = new Set(leads.map((l) => l.id));
    const rest = await claimDialLeads({
      ...base,
      limit: limit - leads.length,
      leadIds: explicitIds,
      maxAttempts,
      cooldownMinutes,
    });
    leads.push(...rest.filter((l) => !claimedIds.has(l.id)));
  }
  return NextResponse.json({ leads, ttlSeconds: RESERVATION_TTL_SEC });
}
