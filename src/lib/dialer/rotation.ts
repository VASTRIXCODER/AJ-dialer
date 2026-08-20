import type { OrgSettings } from "../org/settings";
import type { OrgRole } from "../permissions";
import { normalizePhone } from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// Caller-ID rotation — PURE module (client- & server-safe).
//
// One org can own several outbound numbers and cycle through them so no single
// number is over-dialed. The pool + cadence live in org settings (admin-editable)
// and are shared by BOTH manual and AI calls, so the whole org rotates together.
// The actual sequence counter is atomic + persisted (see rotation-server.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface RotationPlan {
  /** Normalized E.164 numbers to cycle through (deduped, in order). */
  pool: string[];
  /** Advance to the next number after this many calls (min 1). */
  rotateEvery: number;
}

/** Env-supplied fallbacks (so the pool can be configured without the Admin UI). */
export interface RotationEnv {
  /** Pool from TWILIO_CALLER_IDS (deployment-wide fallback). */
  envPool?: string[];
  /** Cadence from DIAL_ROTATE_EVERY. */
  envRotateEvery?: number;
  /** Single caller ID from TWILIO_CALLER_ID (last-resort). */
  envSingle?: string;
  /**
   * When true AND envPool is non-empty, the env pool is treated as a locked
   * platform default that takes priority over any org-level pool. Non-superadmin
   * org admins cannot override it — only a platform admin changing the env var can.
   */
  platformPriority?: boolean;
}

const clampEvery = (v: unknown): number =>
  Math.max(1, Math.floor(Number(v)) || 1);

const normPool = (arr: unknown): string[] =>
  (Array.isArray(arr) ? arr : [])
    .map((n) => normalizePhone(String(n ?? "")))
    .filter((n): n is string => Boolean(n));

/**
 * Resolve the rotation pool + cadence. Precedence (most specific first):
 *   Platform-priority mode (env.platformPriority = true):
 *     1. Env pool  (TWILIO_CALLER_IDS) — locked platform default
 *     2. Single number (TWILIO_CALLER_ID) — last resort
 *   Normal mode:
 *     1. Admin UI pool  (org settings.dialing.callerIds) + its rotateEvery
 *     2. Env pool       (TWILIO_CALLER_IDS) + DIAL_ROTATE_EVERY
 *     3. Single number  (settings.callerId or TWILIO_CALLER_ID), no real rotation
 * Always returns a usable plan (possibly an empty pool, when nothing is configured).
 */
export function resolveRotation(
  settings: OrgSettings | null | undefined,
  env: RotationEnv = {},
): RotationPlan {
  const d = settings?.dialing;
  const settingsPool = normPool(d?.callerIds);
  const envPool = normPool(env.envPool);

  let pool: string[];
  let rotateEvery: number;

  if (env.platformPriority && envPool.length) {
    // Platform-locked: env pool is the authoritative source; org settings are ignored.
    pool = envPool;
    rotateEvery = clampEvery(env.envRotateEvery ?? d?.rotateEvery);
  } else if (settingsPool.length) {
    pool = settingsPool;
    rotateEvery = clampEvery(d?.rotateEvery);
  } else if (envPool.length) {
    pool = envPool;
    rotateEvery = clampEvery(env.envRotateEvery ?? d?.rotateEvery);
  } else {
    const single =
      normalizePhone(String(d?.callerId ?? "")) ||
      normalizePhone(String(env.envSingle ?? ""));
    pool = single ? [single] : [];
    rotateEvery = clampEvery(d?.rotateEvery ?? env.envRotateEvery);
  }

  // De-dupe while preserving order so rotation is stable + predictable.
  const seen = new Set<string>();
  const unique = pool.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
  return { pool: unique, rotateEvery };
}

/**
 * Pure: pick the pool member for a 1-based monotonic sequence number. The number
 * switches every `rotateEvery` calls and wraps around the pool. Example with a
 * 2-number pool and rotateEvery=3: calls 1-3 → #0, 4-6 → #1, 7-9 → #0, …
 *
 * `offset` shifts the starting index. Reps each pass a stable per-rep offset so
 * they don't all begin on pool[0] — that would concentrate the whole team's
 * first calls on one number and trip carrier spam detection, the exact problem
 * rotation exists to prevent.
 */
export function chooseFromPool(
  pool: string[],
  seq: number,
  rotateEvery: number,
  offset = 0,
): string {
  if (!pool.length) return "";
  const every = Math.max(1, Math.floor(rotateEvery) || 1);
  const s = Math.max(1, Math.floor(seq) || 1);
  const off = ((Math.floor(offset) % pool.length) + pool.length) % pool.length;
  const idx = (Math.floor((s - 1) / every) + off) % pool.length;
  return pool[idx];
}

/**
 * Stable 0..poolLen-1 starting offset derived from a rep's key, so different
 * reps spread across the pool from their very first call. Same key → same
 * offset (deterministic), so a rep's rotation stays predictable.
 */
export function poolOffsetForKey(
  key: string | null | undefined,
  poolLen: number,
): number {
  if (!key || poolLen <= 1) return 0;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  }
  return h % poolLen;
}

/**
 * The 3-digit NANP area code of a phone number, or null for non-NANP/garbage.
 * Accepts E.164 (+1AAANXXXXXX), 11-digit 1-led, or bare 10-digit US numbers.
 */
export function areaCodeOf(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4);
  if (digits.length === 10) return digits.slice(0, 3);
  return null;
}

/**
 * Local presence: the pool numbers whose area code matches the lead's, in pool
 * order. Empty when the lead isn't NANP or no pool number shares its area code.
 * A lead is far more likely to answer a call that looks local, which is the
 * single biggest lever on pickup rate after not being spam-flagged.
 */
export function localPresenceMatches(
  pool: string[],
  destNumber: string | null | undefined,
): string[] {
  const ac = areaCodeOf(destNumber);
  if (!ac) return [];
  return pool.filter((n) => areaCodeOf(n) === ac);
}

/**
 * Remove rep-excluded numbers (toggled off in the dialer's caller-ID picker)
 * from the pool before rotation/local-presence runs, so an excluded number is
 * never dialed from — not even as a local-presence match. Falls back to the
 * full pool if excluding would leave nothing to dial from (e.g. a stale
 * client-side exclusion list from before the org's pool shrank) — the picker
 * UI also blocks excluding the last enabled number, but the server shouldn't
 * trust that a payload honored it.
 */
export function filterExcluded(
  pool: string[],
  excluded?: string[] | null,
): string[] {
  if (!excluded || !excluded.length) return pool;
  const set = new Set(normPool(excluded));
  const kept = pool.filter((n) => !set.has(n));
  return kept.length ? kept : pool;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-rep caller-ID assignment.
//
// The pool above is still org-wide (one admin-edited list). This layer answers
// a narrower question: given the person actually placing THIS call, which part
// of that pool are they allowed to dial from? Owner/admin/manager are always
// unrestricted — the same owner/admin/manager-vs-rep split already used to
// scope which LEADS a rep can dial (see dialScope in (app)/layout.tsx).
// Reps are restricted to their assigned numbers, ONLY on the manual power
// dialer — AI calls and the org's shared rotation elsewhere are unaffected by
// an assignment; this module doesn't know about those call paths at all.
// ─────────────────────────────────────────────────────────────────────────────

/** Max caller IDs an admin may pin to one rep. "1-2" is the product ask; the
 *  cap is enforced here (pure, shared by the server mutation and its tests)
 *  rather than only in the mutation, so a UI checkbox list can import the
 *  same number instead of hardcoding a second copy of it. */
export const MAX_CALLER_IDS_PER_REP: number = 2;

/**
 * The pool a specific member may actually dial from.
 *
 * - owner/admin/manager (or an unknown/missing role — fail OPEN to unrestricted
 *   rather than silently locking someone out on a role lookup that came back
 *   empty): the full pool, unrestricted.
 * - rep with assigned numbers: the pool filtered down to the INTERSECTION with
 *   their assignment, in pool order — so an admin's rotation-pool edits (order,
 *   removals) still govern how an assigned rep's numbers cycle. A rep whose
 *   assignment no longer overlaps the live pool at all (every assigned number
 *   was removed from the pool since) falls back to the full pool rather than
 *   being silently unable to dial — a stale assignment must never be able to
 *   block someone from working leads.
 * - rep with no assignment yet: the full pool. Assignment is opt-in per rep;
 *   nobody is blocked from dialing just because an admin hasn't gotten to them.
 */
export function restrictToAssignedNumbers(
  pool: string[],
  role: OrgRole | null | undefined,
  assigned: string[] | null | undefined,
): string[] {
  // Anything other than the literal "rep" is unrestricted — that includes a
  // missing/null role, not just owner/admin/manager, so a role lookup that
  // came back empty fails OPEN rather than accidentally restricting someone
  // whose role this function couldn't determine.
  if (role !== "rep") return pool;
  const assignedSet = new Set(normPool(assigned));
  if (!assignedSet.size) return pool;
  const restricted = pool.filter((n) => assignedSet.has(n));
  return restricted.length ? restricted : pool;
}

/** One rep's newly-planned assignment: which numbers, and their id for the
 *  caller to map back onto a member row. */
export interface PlannedCallerIdAssignment {
  memberId: string;
  callerIds: string[];
}

/**
 * Deal the org's pool out to its reps, "1-2 numbers" each, round by round —
 * every rep gets a 1st number before anyone gets a 2nd, so the numbers land
 * as evenly as possible instead of filling the first rep to the cap before
 * touching the second. Reps are dealt to IN THE ORDER GIVEN (callers pass
 * them oldest-first, matching listMembers), and dealing never overwrites a
 * rep's EXISTING assignment — a rep who already holds a number keeps it
 * counted against their cap, so re-running this after a partial manual
 * assignment tops reps up rather than reshuffling everyone.
 *
 * More reps than numbers: the tail of the rep list gets nothing (they fall
 * back to the full pool at call time — see restrictToAssignedNumbers — so
 * this never blocks anyone from dialing, it just leaves them unassigned).
 * More numbers than 2×reps: the leftover numbers are simply never assigned;
 * they stay reachable to owner/admin/manager via the unrestricted pool.
 *
 * Pure — no I/O, no randomness — so the actual round-robin can be unit tested
 * without a database; the caller (autoAssignCallerIds) does the reads/writes.
 */
export function planAutoAssignCallerIds(
  pool: string[],
  reps: { memberId: string; existing: string[] }[],
): PlannedCallerIdAssignment[] {
  const uniquePool = [...new Set(normPool(pool))];
  const taken = new Set(reps.flatMap((r) => normPool(r.existing)));
  const available = uniquePool.filter((n) => !taken.has(n));

  const result = new Map<string, string[]>(
    reps.map((r) => [r.memberId, normPool(r.existing)]),
  );

  let i = 0;
  // Round-robin over available numbers: one pass per "round" fills every rep's
  // Nth slot before any rep gets an (N+1)th, up to the cap.
  outer: while (i < available.length) {
    let dealtThisRound = false;
    for (const r of reps) {
      if (i >= available.length) break outer;
      const have = result.get(r.memberId)!;
      if (have.length >= MAX_CALLER_IDS_PER_REP) continue;
      have.push(available[i]);
      i++;
      dealtThisRound = true;
    }
    if (!dealtThisRound) break; // every rep already at cap; stop even if numbers remain
  }

  return reps.map((r) => ({ memberId: r.memberId, callerIds: result.get(r.memberId)! }));
}
