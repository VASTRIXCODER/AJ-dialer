// ─────────────────────────────────────────────────────────────────────────────
// Pure claim bookkeeping for the dialer's reservation flow (E3).
//
// When `settings.dialing.reservations` is on, the engine no longer slices the
// local queue to decide who gets dialed — it POSTs /api/dialer/claim and dials
// exactly the leads the server handed back, which are exclusively HELD for this
// rep for the reservation TTL. Two problems fall out of that, both solved here
// as pure functions so they can be unit-tested without React or fetch:
//
//  • The claimed leads may not be in the locally-loaded queue array at all
//    (another page of the book, a fresher fetch, a pack narrowed server-side).
//    The UI must show what is ACTUALLY being dialed, so claim results are
//    merged into the display queue — appended, deduped by id, never reordering
//    what the rep is already looking at.
//
//  • A hold must be released on exactly the right occasions. Skip/cancel/reset
//    → release client-side (nothing was filed, the lead should be immediately
//    claimable by anyone). Disposition → release NOTHING from the client: the
//    server releases the hold itself when the outcome lands (markLeadAttempted
//    inside insertCallRecord), and a client release racing that write could
//    hand the lead to another rep before the attempt counter advanced.
// ─────────────────────────────────────────────────────────────────────────────

import type { Lead } from "@/lib/types";

/** Why a hold is being let go — decides who does the releasing. */
export type ClaimReleaseAction = "skip" | "reset" | "disposition";

/**
 * Merge freshly-claimed leads into the display queue: append any claim the
 * queue doesn't already hold (dedupe by id, including within the claim batch
 * itself). Returns the SAME array when nothing changes, so React state setters
 * can bail without a re-render.
 */
export function mergeClaimedLeads(queue: Lead[], claimed: Lead[]): Lead[] {
  if (!claimed.length) return queue;
  const seen = new Set(queue.map((l) => l.id));
  const additions: Lead[] = [];
  for (const lead of claimed) {
    if (!lead?.id || seen.has(lead.id)) continue;
    seen.add(lead.id);
    additions.push(lead);
  }
  return additions.length ? [...queue, ...additions] : queue;
}

/**
 * Which held lead ids to release client-side for a given teardown. Skip and
 * reset release every hold (deduped, blanks dropped); a disposition releases
 * none — the server clears the hold when the outcome write lands.
 */
export function computeReleaseSet(
  action: ClaimReleaseAction,
  held: Iterable<string>,
): string[] {
  if (action === "disposition") return [];
  return [...new Set([...held].filter(Boolean))];
}

/**
 * The honest message for an empty claim response. An empty claim does NOT mean
 * the book is empty — it usually means every eligible lead is held by another
 * rep (or the AI cron) or cooling down, and saying "no leads" would send the
 * rep off to re-import a list they already have.
 */
export function claimEmptyMessage(queueSize: number): string {
  return queueSize > 0
    ? `All eligible leads are claimed or cooling down — ${queueSize} in queue. Try again in a moment.`
    : "No leads are loaded — press “Load leads” to build a session first.";
}
