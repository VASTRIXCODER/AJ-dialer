import "server-only";

import type { OrgSettings } from "../org/settings";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { twilioConfig } from "../twilio";
import { chooseFromPool, resolveRotation } from "./rotation";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side caller-ID rotation. The pool is shared across the org, but the
// sequence counter is PER REP (keyed by the rep's user id) so every rep cycles
// the pool on their own counter — rep A's calls never advance rep B's number.
// Backed by an atomic keyed Postgres counter (dial_counters via the
// app_next_dial_seq RPC); falls back to an in-memory counter in demo mode.
//
// The pool + cadence come from the Admin UI (org settings) OR env vars
// (TWILIO_CALLER_IDS / DIAL_ROTATE_EVERY) as a deployment-wide fallback.
// ─────────────────────────────────────────────────────────────────────────────

const ENV_POOL = (process.env.TWILIO_CALLER_IDS ?? "")
  .split(/[,\n]/)
  .map((s) => s.trim())
  .filter(Boolean);
const ENV_ROTATE_EVERY = Math.floor(Number(process.env.DIAL_ROTATE_EVERY)) || 0;

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
 */
export async function nextCallerId(
  repKey: string | null | undefined,
  settings: OrgSettings | null | undefined,
): Promise<string> {
  const { pool, rotateEvery } = resolveRotation(settings, {
    envPool: ENV_POOL,
    envRotateEvery: ENV_ROTATE_EVERY,
    envSingle: twilioConfig.callerId,
  });
  if (pool.length <= 1) return pool[0] ?? "";
  const seq = await nextDialSeq(repKey);
  return chooseFromPool(pool, seq, rotateEvery);
}
