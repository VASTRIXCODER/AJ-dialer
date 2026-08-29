import { NextResponse } from "next/server";
import { BEHAVIOR_TO_OUTCOME } from "@/lib/dispositions/defs";
import { getReviewById } from "@/lib/db/review-queue";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";
import {
  actionRequiresKey,
  applyReviewAction,
  canActOnReview,
  type ReviewAction,
} from "@/lib/reviews/actions";
import { resolveDispositionByKey } from "@/lib/status";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adjudicate one needs-review row (F1):
 *   accept  — apply the AI's proposed key to call_records.disposition, resolve.
 *   change  — apply the reviewer's chosen key instead, resolve as 'changed'.
 *   dismiss — close the review without touching the record.
 *
 * Authorization: a supervisor, or the rep who owns the underlying call. The
 * transition table (src/lib/reviews/actions.ts) refuses anything but an OPEN
 * row, so replays and double-clicks can't rewrite a record twice.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ ok: false, error: "Bad review id." }, { status: 400 });
  }
  const scope = await getScope();
  if (!scope?.orgId) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Reviews need a connected database." },
      { status: 503 },
    );
  }
  const rl = rateLimit(`review-act:${scope.userId}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    dispositionKey?: string;
  };
  const action = body.action as ReviewAction;

  const row = await getReviewById(id);
  // Cross-org rows are indistinguishable from missing ones on purpose.
  if (!row || row.orgId !== scope.orgId) {
    return NextResponse.json({ ok: false, error: "Review not found." }, { status: 404 });
  }
  if (
    !canActOnReview({
      supervisor: scope.supervisor,
      userId: scope.userId,
      recordOwnerId: row.ownerId,
    })
  ) {
    return NextResponse.json(
      { ok: false, error: "You don't have access to this review." },
      { status: 403 },
    );
  }

  const transition = applyReviewAction(row.status, action);
  if (!transition.ok) {
    return NextResponse.json({ ok: false, error: transition.error }, { status: 409 });
  }

  const keyCheck = actionRequiresKey(
    action,
    row.proposedDisposition,
    typeof body.dispositionKey === "string" ? body.dispositionKey : null,
  );
  if (!keyCheck.ok) {
    return NextResponse.json({ ok: false, error: keyCheck.error }, { status: 400 });
  }

  const admin = createAdminClient();

  // Apply the chosen key to the record (accept/change). The key is validated
  // against the ORG's resolved taxonomy — an unknown key is refused rather
  // than stored, so the disposition column never grows a value no report or
  // filter can name.
  if (keyCheck.key) {
    if (!row.callRecordId) {
      return NextResponse.json(
        { ok: false, error: "This review has no call record to disposition." },
        { status: 409 },
      );
    }
    const viewer = await getViewer();
    const def = resolveDispositionByKey(
      viewer.org?.settings.dispositions,
      keyCheck.key,
    );
    if (!def) {
      return NextResponse.json(
        { ok: false, error: "That disposition doesn't exist in this workspace." },
        { status: 400 },
      );
    }
    await admin
      .from("call_records")
      .update({ disposition: def.key })
      .eq("id", row.callRecordId);
    // Fill the canonical outcome ONLY into an empty slot: an un-dispositioned
    // record (e.g. the analyzer-fell-back case) becomes countable, but an
    // outcome already filed — by a rep or the AI pipeline — is never rewritten
    // from the review lane (that's what the full override flow is for).
    await admin
      .from("call_records")
      .update({ outcome: BEHAVIOR_TO_OUTCOME[def.behavior] })
      .eq("id", row.callRecordId)
      .is("outcome", null);
  }

  const { error } = await admin
    .from("call_review_queue")
    .update({
      status: transition.status,
      resolved_by: scope.userId,
      resolved_at: new Date().toISOString(),
      resolution: transition.resolution,
    })
    .eq("id", id)
    .eq("status", "open");
  if (error) {
    return NextResponse.json(
      { ok: false, error: "Couldn't update the review." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, status: transition.status });
}
