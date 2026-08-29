// ─────────────────────────────────────────────────────────────────────────────
// Review-queue actions — PURE module (no server-only, no I/O). The transition
// table for a call_review_queue row, kept out of the API route so the validity
// rules are unit-testable and shared with the client (buttons disable on the
// same logic the server enforces).
// ─────────────────────────────────────────────────────────────────────────────

export type ReviewStatus = "open" | "resolved" | "dismissed";
export type ReviewAction = "accept" | "change" | "dismiss";

export const REVIEW_ACTIONS: readonly ReviewAction[] = ["accept", "change", "dismiss"];

export type ReviewTransition =
  | { ok: true; status: ReviewStatus; resolution: "accepted" | "changed" | "dismissed" }
  | { ok: false; error: string };

/**
 * Apply an action to a review row. Only OPEN rows are actionable — a resolved
 * or dismissed review is history, and replaying an action against it (a stale
 * tab, a double-click, an outbox retry) must be refused rather than silently
 * re-writing the record it once pointed at.
 */
export function applyReviewAction(
  current: ReviewStatus,
  action: ReviewAction,
): ReviewTransition {
  if (!REVIEW_ACTIONS.includes(action)) {
    return { ok: false, error: "Unknown review action." };
  }
  if (current !== "open") {
    return { ok: false, error: "This review was already handled." };
  }
  switch (action) {
    case "accept":
      return { ok: true, status: "resolved", resolution: "accepted" };
    case "change":
      return { ok: true, status: "resolved", resolution: "changed" };
    case "dismiss":
      return { ok: true, status: "dismissed", resolution: "dismissed" };
  }
}

/**
 * Who may act on a review row: a supervisor (org-wide), or the rep who owns
 * the underlying call. A row with no call record attached has no owner to
 * grant through, so only supervisors can touch it.
 */
export function canActOnReview(input: {
  supervisor: boolean;
  userId: string;
  recordOwnerId: string | null;
}): boolean {
  if (input.supervisor) return true;
  return Boolean(input.recordOwnerId && input.recordOwnerId === input.userId);
}

/** `accept` needs a proposal to accept; `change` needs the picker's choice. */
export function actionRequiresKey(
  action: ReviewAction,
  proposedDisposition: string | null,
  chosenKey: string | null,
): { ok: true; key: string } | { ok: false; error: string } | { ok: true; key: null } {
  if (action === "dismiss") return { ok: true, key: null };
  if (action === "accept") {
    return proposedDisposition
      ? { ok: true, key: proposedDisposition }
      : { ok: false, error: "This review has no proposed disposition to accept." };
  }
  return chosenKey
    ? { ok: true, key: chosenKey }
    : { ok: false, error: "Pick a disposition to change to." };
}
