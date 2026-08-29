import { NextResponse } from "next/server";
import {
  REACTIVATION_COHORTS,
  reactivationCohort,
} from "@/lib/dialer/reactivation";
import {
  countReactivationCohort,
  listReactivationCandidates,
} from "@/lib/db/reactivation";
import { buildSession, MAX_SESSION_LEADS } from "@/lib/db/session-builder";
import { getScope } from "@/lib/db/scope";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Reactivation studio (P2.9). GET = the cohorts with live planner counts;
// POST = materialise one cohort into a dial list. Supervisors sweep the org's
// book; reps sweep their own — the same fencing buildSession applies to every
// other session. The response is loaded through the dialer's SessionBuilder
// contract (strict order, no refill), so a sweep can never wander off-list.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const scope = await getScope();
  if (!scope?.orgId) return NextResponse.json({ cohorts: [] });
  const orgWide = scope.supervisor;
  const counts = await Promise.all(
    REACTIVATION_COHORTS.map((cohort) =>
      countReactivationCohort({ scope, cohort, orgWide }),
    ),
  );
  return NextResponse.json({
    orgWide,
    cohorts: REACTIVATION_COHORTS.map((c, i) => ({
      key: c.key,
      label: c.label,
      hint: c.hint,
      statuses: c.statuses,
      agedDays: c.agedDays,
      count: counts[i],
    })),
  });
}

export async function POST(req: Request) {
  const scope = await getScope();
  if (!scope?.orgId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const rl = rateLimit(`reactivation:${scope.userId}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    cohort?: string;
    limit?: number;
  };
  const cohort = reactivationCohort(String(body.cohort ?? ""));
  if (!cohort) {
    return NextResponse.json({ error: "Unknown cohort." }, { status: 400 });
  }
  const limit = Math.max(1, Math.min(Number(body.limit) || 50, 200));
  const orgWide = scope.supervisor;

  const candidates = await listReactivationCandidates({ scope, cohort, orgWide, limit });
  if (!candidates.ids.length) {
    return NextResponse.json({ leads: [], excluded: candidates.excluded, count: 0 });
  }

  // Materialise through the session builder: re-fences scope + org, blocks DNC
  // statuses, scrubs suppressed numbers, and preserves the cohort's order.
  const leads = await buildSession({
    statuses: cohort.statuses,
    contact: "any",
    order: "oldest",
    limit: Math.min(limit, MAX_SESSION_LEADS),
    leadIds: candidates.ids,
    orgWide,
  });

  return NextResponse.json({
    leads,
    count: leads.length,
    excluded: candidates.excluded,
    scanCapped: candidates.scanCapped,
    cohort: { key: cohort.key, label: cohort.label, agedDays: cohort.agedDays, statuses: cohort.statuses },
  });
}
