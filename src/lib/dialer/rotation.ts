import type { OrgSettings } from "../org/settings";
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
}

const clampEvery = (v: unknown): number =>
  Math.max(1, Math.floor(Number(v)) || 1);

const normPool = (arr: unknown): string[] =>
  (Array.isArray(arr) ? arr : [])
    .map((n) => normalizePhone(String(n ?? "")))
    .filter((n): n is string => Boolean(n));

/**
 * Resolve the rotation pool + cadence. Precedence (most specific first):
 *   1. Admin UI pool  (org settings.dialing.callerIds) + its rotateEvery
 *   2. Env pool       (TWILIO_CALLER_IDS) + DIAL_ROTATE_EVERY
 *   3. Single number  (settings.callerId or TWILIO_CALLER_ID), no real rotation
 * The cadence follows whichever source provides the pool. Always returns a
 * usable plan (possibly an empty pool, when nothing is configured at all).
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
  if (settingsPool.length) {
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
 */
export function chooseFromPool(
  pool: string[],
  seq: number,
  rotateEvery: number,
): string {
  if (!pool.length) return "";
  const every = Math.max(1, Math.floor(rotateEvery) || 1);
  const s = Math.max(1, Math.floor(seq) || 1);
  const idx = Math.floor((s - 1) / every) % pool.length;
  return pool[idx];
}
