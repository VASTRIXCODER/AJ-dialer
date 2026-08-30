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

/**
 * Strict-mode empty claim: the LOADED LIST is done (or every remaining lead in
 * it is held/cooling/ineligible) — categorically different from "the org has
 * nothing to dial", and the rep must be told which one happened.
 */
export function strictQueueExhaustedMessage(queueSize: number, refillAvailable: boolean): string {
  if (queueSize === 0) {
    return "No leads are loaded — press “Load leads” to build a session first.";
  }
  return refillAvailable
    ? "Your loaded list is finished (or its remaining leads are held or cooling down). Auto-refill found nothing eligible either — load a new session."
    : "Your loaded list is finished (or its remaining leads are held or cooling down). Load a new session, or turn on “Auto-refill” in the session builder to keep dialing from your eligible pool.";
}

/**
 * The ordered claim candidates for the next round: the display queue's lead
 * ids starting at the rep's CURRENT position, wrapping around the list at most
 * once, capped at `max`.
 *
 * This list is the whole fix for the dialer's worst bug: claims used to carry
 * NO lead scoping at all, so pressing Start dialed the org pool's
 * top-eligibility lead — someone who was not in the list the rep loaded, and
 * the SAME someone on every retry. Constraining the claim to these ids (in
 * this order, with p_preserve_order) makes the dialer call exactly the list on
 * screen, top to bottom from where the rep is standing.
 */
export function orderedCandidateIds(
  queue: readonly { id: string }[],
  cursor: number,
  max: number,
): string[] {
  if (!queue.length || max <= 0) return [];
  const start = ((Math.floor(cursor) % queue.length) + queue.length) % queue.length;
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length && out.length < max; i++) {
    const id = queue[(start + i) % queue.length]?.id;
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ── The picked lead ──────────────────────────────────────────────────────────
//
// The bug this section exists for: a rep searched the queue for ONE person,
// picked them, pressed Start — and a completely different person answered.
//
// selectLead only moved the cursor, and the claim opens a 200-wide window AT
// the cursor and takes the first ELIGIBLE lead in it. So a pick that was held
// by a teammate, cooling down between attempts, at its attempt cap, DNC'd, or
// outside its calling window was silently skipped and the NEXT candidate was
// dialed instead — while the panel went on naming the lead the rep chose.
//
// An explicit pick is an instruction, not a starting position. It is dialed,
// or the round is refused and the rep is told why. There is no third option.

/** A lead the rep PICKED BY NAME could not be claimed. Never a substitution. */
export function pinnedLeadUnavailableMessage(name: string): string {
  return `${name} can’t be dialed right now — the lead is held by another rep, cooling down between attempts, at its attempt limit, on the Do-Not-Call list, or outside its calling window. Nobody else was dialed in their place. Try again in a moment, or pick a different lead.`;
}

/** One claim round-trip, as the engine's fetch-backed caller implements it. */
export type ClaimFn<T> = (req: { count: number; leadIds: string[] }) => Promise<T[]>;

export type PinnedRoundOutcome<T> =
  /** Dial these, `leads[0]` being the pick. `candidates` re-ranks the round. */
  | { status: "dial"; leads: T[]; candidates: string[] }
  /** Dial NOBODY. Show `message`; hand `release` back to the pool. */
  | { status: "refuse"; message: string; release: string[] };

/**
 * Build the round for an explicitly picked lead.
 *
 * Claims the pick ALONE first, so eligibility is decided about them and nobody
 * else. Only if that succeeds are the remaining parallel lanes filled from the
 * rest of the rep's window — the pick always leads the round. If the pick
 * can't be claimed, the round is refused and any lead the server handed back
 * anyway is released rather than left locked for the reservation TTL.
 *
 * Pure except for the injected `claim`, so the whole decision is testable
 * against a fake server — no React, no fetch.
 */
export async function claimPinnedRound<
  T extends { id: string },
>(opts: {
  pinned: T;
  /** The rep's ordered claim window (starts at the pick). */
  candidates: readonly string[];
  /** Lines this round may use; 1 means the pick and nobody else. */
  parallel: number;
  claim: ClaimFn<T>;
  /** How to name the pick in the refusal message. */
  describe: (lead: T) => string;
}): Promise<PinnedRoundOutcome<T>> {
  const { pinned, parallel, claim, describe } = opts;
  const held = await claim({ count: 1, leadIds: [pinned.id] });
  const got = held.find((l) => l.id === pinned.id);
  if (!got) {
    return {
      status: "refuse",
      message: pinnedLeadUnavailableMessage(describe(pinned)),
      // Scoping the claim to one id means anything else coming back is a
      // server bug — but an undialed hold locks that lead away from every
      // other rep for the TTL, so give it straight back.
      release: held.map((l) => l.id).filter((id) => id !== pinned.id),
    };
  }
  const leads: T[] = [got];
  let candidates = [...opts.candidates];
  const spare = Math.max(0, Math.floor(parallel) - 1);
  const rest = candidates.filter((id) => id !== pinned.id);
  if (spare > 0 && rest.length) {
    const extra = await claim({ count: spare, leadIds: rest });
    leads.push(...extra.filter((l) => l.id !== pinned.id));
    candidates = [pinned.id, ...rest];
  }
  return { status: "dial", leads, candidates };
}

/**
 * Claims come back in server order; the ROUND must run in the rep's order.
 * Defensive re-sort by the candidate list (unknown ids — a refill claim —
 * keep their relative order at the end).
 */
export function reorderClaimed<T extends { id: string }>(
  claimed: T[],
  candidateIds: readonly string[],
): T[] {
  if (claimed.length < 2) return claimed;
  const rank = new Map(candidateIds.map((id, i) => [id, i]));
  return [...claimed].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Where the queue cursor should stand after a round was claimed: just past the
 * FURTHEST claimed lead (so the next Start keeps walking forward instead of
 * re-offering leads the round already consumed). Claims outside the queue
 * (refill mode) leave the cursor alone.
 */
export function advanceCursorPastClaims(
  queue: readonly { id: string }[],
  cursor: number,
  claimedIds: readonly string[],
): number {
  if (!queue.length || !claimedIds.length) return cursor;
  const claimed = new Set(claimedIds);
  const start = ((Math.floor(cursor) % queue.length) + queue.length) % queue.length;
  let furthest = -1;
  for (let i = 0; i < queue.length; i++) {
    if (claimed.has(queue[(start + i) % queue.length]?.id)) furthest = i;
  }
  return furthest === -1 ? cursor : (start + furthest + 1) % queue.length;
}
