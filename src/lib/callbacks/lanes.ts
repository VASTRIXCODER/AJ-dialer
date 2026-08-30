import { parseFloating } from "../appointments/time";

// ─────────────────────────────────────────────────────────────────────────────
// Callback lane + escalation derivation — PURE, importable from Server and
// Client Components and unit-testable at a fixed clock.
//
// Lanes are ALWAYS derived from `due_at` against "now", never stored. A stored
// "overdue" status would freeze the moment someone last looked at the row;
// deriving it means a callback that slips past its time escalates on its own —
// including the "missed" tier — with no cron and no write.
//
// `due_at` follows the same FLOATING wall-clock convention as
// `appointments.scheduled_at` (see src/lib/appointments/time.ts): parse through
// `parseFloating`, never `new Date(isoWithOffset)`, or "call back at 5pm"
// shifts by the viewer's UTC offset and lands in the wrong lane.
// ─────────────────────────────────────────────────────────────────────────────

export type CallbackLane = "overdue" | "due" | "upcoming";

/**
 * How late an overdue callback is:
 *  - "grace"  — just slipped (≤ 2h). Still very winnable.
 *  - "amber"  — > 2h late. The promise is going cold.
 *  - "missed" — > 24h late. Derived, NEVER a stored status: the row is still
 *    open and still claimable, the board just stops pretending it's fresh.
 */
export type OverdueTier = "grace" | "amber" | "missed";

/** ±1 minute around the agreed time still reads as "due now", not "overdue". */
export const DUE_WINDOW_MS = 60_000;
export const AMBER_AFTER_MS = 2 * 60 * 60 * 1000;
export const MISSED_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * -- LOCKSTEP: keep in sync with app_claim_callback in supabase/schema.sql --
 * The RPC lets a claim be taken over once `claimed_at < now() - interval
 * '15 minutes'`; this constant is the client-side mirror so the board's
 * "claimed by" display and the DB's actual takeover rule can never disagree.
 */
export const CLAIM_STALE_MS = 15 * 60_000;

/** Floating `due_at` → epoch ms in the viewer's zone, or null when unset. */
export function dueAtMs(dueAt: string | null | undefined): number | null {
  const d = parseFloating(dueAt ?? null);
  return d ? d.getTime() : null;
}

/**
 * "Now" on the ORG's wall clock, in the same units `laneOf` compares against.
 *
 * This exists because `due_at` is a FLOATING time — "call back at 5pm", with no
 * zone — and `parseFloating` necessarily resolves it in whatever zone the
 * runtime happens to be in. Comparing that against a bare `Date.now()` silently
 * compares two different clocks:
 *
 *   · on the server (Vercel runs UTC), a Chicago org's 5pm promise resolved to
 *     17:00 UTC and was therefore "overdue" from noon local — five hours early,
 *     every day, on the tiles at the top of /callbacks.
 *   · in the browser it resolved in the REP's zone, so the board underneath
 *     those tiles disagreed with them from the very first paint for anyone not
 *     sitting in the server's zone.
 *
 * Passing "now" through `parseFloating` too means the runtime's own zone is
 * applied to BOTH sides and cancels out exactly, whatever it is.
 * `src/lib/dialer/schedule.ts` documents this same failure as the reason
 * `zonedFloatingNow` exists; the database layer was fixed for it and this one
 * was not.
 */
export function orgNowMs(now: Date, orgFloatingNow: string): number {
  return dueAtMs(orgFloatingNow) ?? now.getTime();
}

/**
 * Which lane a callback belongs in right now. A callback with NO agreed time
 * is honestly "due" — it was promised, it has no future slot to wait for.
 */
export function laneOf(dueAt: string | null | undefined, nowMs: number): CallbackLane {
  const t = dueAtMs(dueAt);
  if (t == null) return "due";
  if (t < nowMs - DUE_WINDOW_MS) return "overdue";
  if (t > nowMs + DUE_WINDOW_MS) return "upcoming";
  return "due";
}

/** Escalation tier for an overdue callback; null when it isn't overdue at all. */
export function overdueTier(
  dueAt: string | null | undefined,
  nowMs: number,
): OverdueTier | null {
  const t = dueAtMs(dueAt);
  if (t == null || laneOf(dueAt, nowMs) !== "overdue") return null;
  const late = nowMs - t;
  if (late > MISSED_AFTER_MS) return "missed";
  if (late > AMBER_AFTER_MS) return "amber";
  return "grace";
}

/**
 * Is this claim still LIVE — i.e. would app_claim_callback refuse another user
 * right now? Mirrors the RPC exactly (LOCKSTEP above): no claimant or a claim
 * older than 15 minutes is up for grabs, so the board must not show it as
 * "being worked".
 */
export function isClaimActive(
  claimedBy: string | null | undefined,
  claimedAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (!claimedBy || !claimedAt) return false;
  const t = Date.parse(claimedAt); // real timestamptz instant, not floating
  if (Number.isNaN(t)) return false;
  return nowMs - t < CLAIM_STALE_MS;
}

/** The fields the in-lane ordering reads. */
export interface SortableCallback {
  priority: number;
  dueAt: string | null;
  createdAt: string;
}

/**
 * In-lane ordering: flagged (higher priority) first, then soonest/oldest due
 * first — which puts the MOST overdue on top of the Overdue lane and the next
 * due on top of Upcoming — timeless rows after timed ones, oldest promise
 * first as the final tiebreak.
 */
export function compareCallbacks(a: SortableCallback, b: SortableCallback): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const ta = dueAtMs(a.dueAt);
  const tb = dueAtMs(b.dueAt);
  if (ta != null && tb != null && ta !== tb) return ta - tb;
  if ((ta == null) !== (tb == null)) return ta == null ? 1 : -1;
  const ca = Date.parse(a.createdAt) || 0;
  const cb = Date.parse(b.createdAt) || 0;
  return ca - cb;
}
