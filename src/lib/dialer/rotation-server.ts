import "server-only";

import type { OrgSettings } from "../org/settings";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { twilioConfig } from "../twilio";
import {
  chooseFromPool,
  localPresenceMatches,
  poolOffsetForKey,
  resolveRotation,
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
 */
export async function nextCallerId(
  repKey: string | null | undefined,
  settings: OrgSettings | null | undefined,
  destNumber?: string | null,
): Promise<string> {
  const { pool, rotateEvery } = resolveRotation(settings, {
    envPool: ENV_POOL,
    envRotateEvery: ENV_ROTATE_EVERY,
    envSingle: twilioConfig.callerId,
    platformPriority: PLATFORM_POOL_LOCKED,
  });
  if (!pool.length) return "";

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
 */
export async function nextCallerIdWithInfo(
  repKey: string | null | undefined,
  settings: OrgSettings | null | undefined,
  destNumber?: string | null,
): Promise<CallerIdInfo> {
  const { pool, rotateEvery } = resolveRotation(settings, {
    envPool: ENV_POOL,
    envRotateEvery: ENV_ROTATE_EVERY,
    envSingle: twilioConfig.callerId,
    platformPriority: PLATFORM_POOL_LOCKED,
  });
  if (!pool.length) {
    return { callerId: "", pool: [], poolIndex: 0, rotateEvery: 1, localPresence: false };
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
