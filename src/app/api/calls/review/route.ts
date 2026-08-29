import { NextResponse } from "next/server";
import { logLeadEvent } from "@/lib/db/lead-events";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";
import { publishOrgEvent } from "@/lib/realtime/publish";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: unknown): string | null =>
  typeof v === "string" && UUID.test(v) ? v : null;

/**
 * Flag a call for supervisor review (E3's wrap-up [Flag for review] button).
 * Inserts an open `call_review_queue` row for the viewer's org — the review
 * lane UI lands in F1; until then the rows accumulate and the `review.created`
 * broadcast already reaches the floor.
 *
 * The flag usually fires BEFORE the disposition (the wrap-up screen is still
 * up), so there may be no call_record yet — `call_record_id` is resolved when
 * possible (explicit id, or the attempt's client id) and left null otherwise.
 * The rep's note + lead reference land on the LEAD's timeline (lead_events),
 * which is where a supervisor reading the flag goes first anyway.
 *
 * Only `rep_flagged` is accepted here: every other review reason
 * (low_confidence, conflict, …) is the server-side analyzer's verdict (F1),
 * never a client claim.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }
  const scope = await getScope();
  if (!scope?.orgId || !scope.userId) {
    return NextResponse.json(
      { ok: false, error: "Reviews need an active workspace." },
      { status: 400 },
    );
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Reviews need a connected database." },
      { status: 503 },
    );
  }
  const rl = rateLimit(`review:${scope.userId}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    callRecordId?: string;
    leadId?: string;
    clientAttemptId?: string;
    reason?: string;
    note?: string;
  };
  if (body.reason !== "rep_flagged") {
    return NextResponse.json(
      { ok: false, error: "Only rep_flagged reviews can be filed here." },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();

    // Resolve the call record when it already exists — explicit id first, then
    // the attempt's client idempotency id (set at dial time, so it can find a
    // record filed moments earlier by an outbox replay).
    let callRecordId = asUuid(body.callRecordId);
    const clientAttemptId = asUuid(body.clientAttemptId);
    if (!callRecordId && clientAttemptId) {
      const { data } = await admin
        .from("call_records")
        .select("id")
        .eq("client_attempt_id", clientAttemptId)
        .maybeSingle();
      callRecordId = asUuid((data as { id?: string } | null)?.id);
    }

    const { data: row, error } = await admin
      .from("call_review_queue")
      .insert({
        org_id: scope.orgId,
        call_record_id: callRecordId,
        reason: "rep_flagged",
        status: "open",
      })
      .select("id")
      .maybeSingle();
    if (error || !row?.id) {
      return NextResponse.json(
        { ok: false, error: "Couldn't file the review." },
        { status: 500 },
      );
    }
    const reviewId = String(row.id);

    // The rep's context (note + which contact) lives on the lead's timeline —
    // the queue table has no note column, and the timeline is where a
    // supervisor reading the flag looks first.
    const leadId = asUuid(body.leadId);
    if (leadId) {
      logLeadEvent({
        leadId,
        orgId: scope.orgId,
        actorId: scope.userId,
        kind: "note",
        payload: {
          source: "review_flag",
          reviewId,
          note: typeof body.note === "string" ? body.note.slice(0, 1000) : undefined,
        },
      });
    }

    publishOrgEvent(scope.orgId, "review.created", {
      reviewId,
      callRecordId,
      reason: "rep_flagged",
    });

    return NextResponse.json({ ok: true, id: reviewId });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Couldn't file the review." },
      { status: 500 },
    );
  }
}
