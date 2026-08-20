import "server-only";

import type { OrgSettings } from "../org/settings";
import type { OrgRole } from "../permissions";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { twilioConfig } from "../twilio";
import {
  chooseFromPool,
  filterExcluded,
  localPresenceMatches,
  poolOffsetForKey,
  resolveRotation,
  restrictToAssignedNumbers,
} from "./rotation";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side caller-ID rotation. The pool is shared across the org, but the
// sequence counter is PER REP (keyed by the rep's user id) so every rep cycles
// the pool on their own counter — rep A's calls never advance rep B's number.
// Backed by an atomic keyed Postgres counter (dial_counters via the
// app_next_dial_seq RPC); falls back to an in-memory counter in demo mode.
//
// PLATFORM LOCK: when TWILIO_CALLER_IDS is set, it acts as the authoritative
// pool for ALL orgs and takes priority over any org-level settings. Only a
// platform admin changing the env var can modify these numbers.
// ─────────────────────────────────────────────────────────────────────────────

const ENV_POOL = (process.env.TWILIO_CALLER_IDS ?? "")
  .split(/[,\n]/)
  .map((s) => s.trim())
  .filter(Boolean);
const ENV_ROTATE_EVERY = Math.floor(Number(process.env.DIAL_ROTATE_EVERY)) || 0;

/** True when TWILIO_CALLER_IDS is set — the pool is platform-locked. */
export const PLATFORM_POOL_LOCKED = ENV_POOL.length > 0;

const memSeq = new Map<string, number>();

/** Atomically get the next dial sequence number for a counter key (1, 2, 3, …). */
export async function nextDialSeq(
  key: string | null | undefined,
): Promise<number> {
  if (key && isAdminConfigured()) {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("app_next_dial_seq", {
        p_key: key,
      });
      if (!error && data != null) return Number(data);
    } catch {
      /* fall through to the in-memory counter */
    }
  }
  const k = key || "_global";
  const next = (memSeq.get(k) ?? 0) + 1;
  memSeq.set(k, next);
  return next;
}

/**
 * Pick the next outbound caller ID for a REP, advancing that rep's own rotation
 * counter. Used by every outbound path (manual legs + AI calls). Returns "" only
 * when nothing is configured (caller then falls back to the env caller ID).
 *
 * @param repKey  the rep's user id — their personal rotation counter key
 * @param settings the org settings (shared number pool + cadence)
 * @param destNumber the number being dialed — enables local-presence matching
 * @param excludedCallerIds  numbers the rep toggled off in the dialer's
 *   caller-ID picker. Filtered out of the pool before local-presence matching
 *   and rotation both — an excluded number is never dialed from, even as a
 *   local-presence match. Excluding every pool number falls back to the full
 *   pool (see filterExcluded) rather than failing to dial.
 * @param role  the caller's org role. Omitted (as every AI-call and inbound-leg
 *   caller here does) = unrestricted, matching pre-assignment behavior exactly.
 *   Only the manual power-dialer route passes this — per-rep assignment was a
 *   power-dialer-specific ask; AI calls and the shared rotation elsewhere
 *   intentionally still draw from the org's whole pool.
 * @param assignedCallerIds  the numbers pinned to this rep (Member.callerIds),
 *   applied via restrictToAssignedNumbers BEFORE excludedCallerIds — assignment
 *   is the hard boundary of what a rep may ever dial from; exclusion is their
 *   own opt-out layered on top of that, never a way to reach outside it.
 */
export async function nextCallerId(
  repKey: string | null | undefined,
  settings: OrgSettings | null | undefined,
  destNumber?: string | null,
  excludedCallerIds?: string[] | null,
  role?: OrgRole | null,
  assignedCallerIds?: string[] | null,
): Promise<string> {
  const { pool: orgPool, rotateEvery } = resolveRotation(settings, {
    envPool: ENV_POOL,
    envRotateEvery: ENV_ROTATE_EVERY,
    envSingle: twilioConfig.callerId,
    platformPriority: PLATFORM_POOL_LOCKED,
  });
  const fullPool = restrictToAssignedNumbers(orgPool, role, assignedCallerIds);
  if (!fullPool.length) return "";
  const pool = filterExcluded(fullPool, excludedCallerIds);

  // Local presence: if enabled and a pool number shares the lead's area code,
  // dial from it (rotating among same-area-code numbers if there's more than
  // one). This makes the call look local and lifts pickup rate.
  if (settings?.dialing?.localPresence && destNumber) {
    const matches = localPresenceMatches(pool, destNumber);
    if (matches.length) {
      const seq = await nextDialSeq(repKey);
      return chooseFromPool(matches, seq, rotateEvery, poolOffsetForKey(repKey, matches.length));
    }
  }

  if (pool.length === 1) return pool[0];
  const seq = await nextDialSeq(repKey);
  return chooseFromPool(pool, seq, rotateEvery, poolOffsetForKey(repKey, pool.length));
}

export interface CallerIdInfo {
  callerId: string;
  pool: string[];
  poolIndex: number;
  rotateEvery: number;
  /** True when this number was chosen by area-code (local presence) match. */
  localPresence: boolean;
}

/**
 * Same as nextCallerId but also returns pool metadata so the UI can show which
 * number is active and when it will rotate.
 *
 * @param excludedCallerIds see nextCallerId. The returned `pool`/`poolIndex`
 *   reflect the filtered (excluded numbers removed) pool actually used for
 *   this call, so the "rotating among N" display is accurate to the rep's
 *   current toggle choices, not the full org pool.
 * @param pinnedCallerId Skip rotation and dial from this exact number instead
 *   — for a manual "Dial again" redial, where the whole point is a homeowner
 *   who silenced/missed the first call sees the SAME number calling back (many
 *   Do Not Disturb setups let a repeat call through; a different number isn't
 *   recognizable as a repeat). Falls through to normal rotation when the
 *   number isn't (or is no longer) an eligible pool member — a rep toggling it
 *   off between calls, or a pool edit, must never dial from a stale outside
 *   number. Deliberately does NOT consume nextDialSeq(): a redial retries the
 *   current attempt rather than advancing to the next one, so it must not
 *   perturb the rotation cadence for every dial after it.
 * @param role  see nextCallerId. Omitted = unrestricted (AI/inbound callers).
 * @param assignedCallerIds  see nextCallerId — applied before excludedCallerIds
 *   and before pinnedCallerId is checked, so a rep can never redial-pin a
 *   number outside their own assignment either.
 */
export async function nextCallerIdWithInfo(
  repKey: string | null | undefined,
  settings: OrgSettings | null | undefined,
  destNumber?: string | null,
  excludedCallerIds?: string[] | null,
  pinnedCallerId?: string | null,
  role?: OrgRole | null,
  assignedCallerIds?: string[] | null,
): Promise<CallerIdInfo> {
  const { pool: orgPool, rotateEvery } = resolveRotation(settings, {
    envPool: ENV_POOL,
    envRotateEvery: ENV_ROTATE_EVERY,
    envSingle: twilioConfig.callerId,
    platformPriority: PLATFORM_POOL_LOCKED,
  });
  const fullPool = restrictToAssignedNumbers(orgPool, role, assignedCallerIds);
  if (!fullPool.length) {
    return { callerId: "", pool: [], poolIndex: 0, rotateEvery: 1, localPresence: false };
  }
  const pool = filterExcluded(fullPool, excludedCallerIds);

  if (pinnedCallerId && pool.includes(pinnedCallerId)) {
    return {
      callerId: pinnedCallerId,
      pool,
      poolIndex: Math.max(0, pool.indexOf(pinnedCallerId)),
      rotateEvery,
      localPresence: false,
    };
  }

  // Local presence wins when enabled and a same-area-code number exists.
  if (settings?.dialing?.localPresence && destNumber) {
    const matches = localPresenceMatches(pool, destNumber);
    if (matches.length) {
      const seq = await nextDialSeq(repKey);
      const chosen = chooseFromPool(
        matches,
        seq,
        rotateEvery,
        poolOffsetForKey(repKey, matches.length),
      );
      return {
        callerId: chosen,
        pool,
        poolIndex: Math.max(0, pool.indexOf(chosen)),
        rotateEvery,
        localPresence: true,
      };
    }
  }

  if (pool.length === 1) {
    return { callerId: pool[0], pool, poolIndex: 0, rotateEvery, localPresence: false };
  }
  const seq = await nextDialSeq(repKey);
  const off = poolOffsetForKey(repKey, pool.length);
  const idx =
    (Math.floor((seq - 1) / Math.max(1, rotateEvery)) + off) % pool.length;
  return { callerId: pool[idx], pool, poolIndex: idx, rotateEvery, localPresence: false };
}

/**
 * Returns the platform rotation pool info WITHOUT advancing the counter.
 * Safe to call for display purposes only.
 */
export function getPlatformPool(settings: OrgSettings | null | undefined): {
  pool: string[];
  rotateEvery: number;
  isLocked: boolean;
} {
  const { pool, rotateEvery } = resolveRotation(settings, {
    envPool: ENV_POOL,
    envRotateEvery: ENV_ROTATE_EVERY,
    envSingle: twilioConfig.callerId,
    platformPriority: PLATFORM_POOL_LOCKED,
  });
  return { pool, rotateEvery, isLocked: PLATFORM_POOL_LOCKED };
}
