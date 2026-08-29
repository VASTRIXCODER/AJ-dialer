import { NextResponse } from "next/server";
import { approveMessage, rejectMessage } from "@/lib/db/messages";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Approve or reject a proposed message.
//
// This is the human in "the engine proposes, a named human sends". The approver
// id written here is the one the database CHECK constraint requires before the
// row may reach a sendable status, so this route is not a formality — it is the
// only way a message becomes sendable at all.
//
// Bulk approval is fenced seven ways (see BULK_CAP and the checks below), and
// the fences exist because approving in bulk is where a mistake stops being one
// message and starts being a hundred.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard ceiling per request. Not a performance limit — a blast-radius one. A
 * mistake at 100 is an incident someone can talk their way through; the same
 * mistake at 5,000 is a news story.
 */
const BULK_CAP = 100;

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const scope = await getScope();
  if (!scope?.orgId) {
    return NextResponse.json({ error: "Workspace unavailable." }, { status: 400 });
  }
  const rl = rateLimit(`msg-decide:${scope.userId}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    ids?: string[];
    id?: string;
    action?: string;
    reason?: string;
  };
  const ids = [
    ...new Set(
      (Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : []).map(String).filter(Boolean),
    ),
  ];
  if (!ids.length) {
    return NextResponse.json({ error: "Nothing to decide on." }, { status: 422 });
  }
  if (ids.length > BULK_CAP) {
    return NextResponse.json(
      {
        error: `Approve at most ${BULK_CAP} at a time. A mistake at ${BULK_CAP} is recoverable; a mistake at ${ids.length} is not.`,
      },
      { status: 422 },
    );
  }

  const action = body.action === "reject" ? "reject" : "approve";

  // Rejecting needs only the ability to look at the queue — refusing to send
  // something is never the risky direction, and putting a permission wall in
  // front of "no" is how a bad message goes out because nobody could stop it.
  if (action === "approve") {
    const canApproveAutomation = viewer.permissions.includes("messaging.approve");
    const canApproveOwn = viewer.permissions.includes("messaging.approve.own");
    if (!canApproveAutomation && !canApproveOwn) {
      return NextResponse.json(
        { error: "You don't have permission to approve messages." },
        { status: 403 },
      );
    }
    if (ids.length > 1 && !viewer.permissions.includes("messaging.approve.bulk")) {
      return NextResponse.json(
        { error: "You can approve these one at a time, but not as a batch." },
        { status: 403 },
      );
    }
  } else if (!viewer.permissions.includes("crm.view")) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const decided: string[] = [];
  const missed: string[] = [];
  for (const id of ids) {
    const row =
      action === "approve"
        ? await approveMessage({ id, orgId: scope.orgId, approverId: scope.userId })
        : await rejectMessage({
            id,
            orgId: scope.orgId,
            actorId: scope.userId,
            reason: body.reason,
          });
    // A null result means the compare-and-set found the row somewhere other
    // than `needs_approval` — someone else decided first, or it was cancelled
    // by an opt-out in between. Reported, never silently counted as success.
    if (row) decided.push(id);
    else missed.push(id);
  }

  return NextResponse.json({
    ok: true,
    action,
    decided: decided.length,
    requested: ids.length,
    missed,
  });
}
