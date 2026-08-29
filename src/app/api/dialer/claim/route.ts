import { NextResponse } from "next/server";
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

  const leads = await claimDialLeads({
    orgId: scope.orgId,
    userId: scope.userId,
    supervisor: scope.supervisor,
    limit: Math.min(Math.max(1, Math.round(body.count ?? 1)), 10),
    statuses: Array.isArray(body.statuses) ? body.statuses.slice(0, 12) : [],
    campaignId: typeof body.campaignId === "string" ? body.campaignId : null,
    packId: typeof body.packId === "string" ? body.packId : null,
    leadIds: Array.isArray(body.leadIds) ? body.leadIds.slice(0, 200) : null,
  });
  return NextResponse.json({ leads, ttlSeconds: RESERVATION_TTL_SEC });
}
