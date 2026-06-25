import "server-only";

import type { OrgSettings } from "../org/settings";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { twilioConfig } from "../twilio";
import { chooseFromPool, resolveRotation } from "./rotation";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side caller-ID rotation: the shared, atomic sequence counter that makes
// the whole org advance together across manual + AI calls. Backed by an atomic
// Postgres counter (organizations.dial_seq via the app_next_dial_seq RPC); falls
// back to an in-memory counter in demo mode (no service role).
// ─────────────────────────────────────────────────────────────────────────────

const memSeq = new Map<string, number>();

/** Atomically get the next dial sequence number for an org (1, 2, 3, …). */
export async function nextDialSeq(
  orgId: string | null | undefined,
): Promise<number> {
  if (orgId && isAdminConfigured()) {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("app_next_dial_seq", {
        p_org: orgId,
      });
      if (!error && data != null) return Number(data);
    } catch {
      /* fall through to the in-memory counter */
    }
  }
  const key = orgId || "_global";
  const next = (memSeq.get(key) ?? 0) + 1;
  memSeq.set(key, next);
  return next;
}

/**
 * Pick the next outbound caller ID for an org, advancing the shared rotation
 * counter. Used by every outbound path (manual legs + AI calls) so a single org
 * cycles its numbers together. Returns "" only when nothing is configured.
 */
export async function nextCallerId(
  orgId: string | null | undefined,
  settings: OrgSettings | null | undefined,
): Promise<string> {
  const { pool, rotateEvery } = resolveRotation(settings, twilioConfig.callerId);
  if (pool.length <= 1) return pool[0] ?? "";
  const seq = await nextDialSeq(orgId);
  return chooseFromPool(pool, seq, rotateEvery);
}
