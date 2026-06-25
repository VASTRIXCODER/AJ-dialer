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

/**
 * Resolve the rotation pool + cadence from org settings, falling back to the
 * single configured caller ID (settings.callerId) or the provided env default
 * when no pool is set. Always returns a usable plan (possibly an empty pool).
 */
export function resolveRotation(
  settings: OrgSettings | null | undefined,
  envFallback = "",
): RotationPlan {
  const d = settings?.dialing;
  const raw = Array.isArray(d?.callerIds) ? d.callerIds : [];
  const pool = raw
    .map((n) => normalizePhone(String(n ?? "")))
    .filter((n): n is string => Boolean(n));

  if (pool.length === 0) {
    const single =
      normalizePhone(String(d?.callerId ?? "")) || normalizePhone(envFallback);
    if (single) pool.push(single);
  }

  // De-dupe while preserving order so rotation is stable + predictable.
  const seen = new Set<string>();
  const unique = pool.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));

  const rotateEvery = Math.max(1, Math.floor(Number(d?.rotateEvery ?? 1)) || 1);
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
