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
