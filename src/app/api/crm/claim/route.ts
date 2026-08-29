import { NextResponse } from "next/server";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Claim work off the shared queue.
//
// This is the first caller of `app_claim_work_items`, which has existed since
// PART 37 with no consumer. Using it rather than an UPDATE is the whole point:
// it holds `for update skip locked` over the candidate rows, so two reps
// hitting "Claim 5" in the same second get five DIFFERENT items each instead of
// both being handed the same five and calling the same people.
//
// The lease is real and finite. The surface must show the countdown, because a
// claim that silently expires looks exactly like work vanishing.
// ─────────────────────────────────────────────────────────────────────────────

/** Matches the dialer's reservation lease, so one rep's holds expire together. */
const LEASE_SECONDS = 300;
const MAX_PER_CLAIM = 10;

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!viewer.permissions.includes("work.claim")) {
    return NextResponse.json(
      { error: "You don't have permission to claim shared work." },
      { status: 403 },
    );
  }
  const scope = await getScope();
  if (!scope?.orgId || !isAdminConfigured()) {
    return NextResponse.json({ error: "Workspace unavailable." }, { status: 400 });
  }
  const rl = rateLimit(`crm-claim:${scope.userId}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    count?: number;
    types?: string[];
    queue?: string;
  };
  const count = Math.min(Math.max(1, Math.round(Number(body.count) || 5)), MAX_PER_CLAIM);
  const types =
    Array.isArray(body.types) && body.types.length
      ? body.types.slice(0, 8).map(String)
      : null;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("app_claim_work_items", {
      p_org: scope.orgId,
      p_user: scope.userId,
      p_limit: count,
      p_ttl_seconds: LEASE_SECONDS,
      p_types: types,
      p_queue: typeof body.queue === "string" && body.queue ? body.queue : null,
    });
    if (error) {
      return NextResponse.json({ error: "Couldn't claim right now." }, { status: 500 });
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    // Claiming fewer than asked is normal, not an error — someone else got
    // there first, or the queue is shorter than the request. Report the real
    // number so the surface can say "claimed 2 of 5" instead of implying 5.
    return NextResponse.json({
      claimed: rows.length,
      requested: count,
      leaseSeconds: LEASE_SECONDS,
      ids: rows.map((r) => String(r.id)),
    });
  } catch {
    return NextResponse.json({ error: "Couldn't claim right now." }, { status: 500 });
  }
}
