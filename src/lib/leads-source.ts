import "server-only";
import type { Lead } from "./types";
import { getDialQueue as dbDialQueue } from "./db/leads";

// ─────────────────────────────────────────────────────────────────────────────
// Lead source for the dialer queue.
//
// Delegates to the account-scoped DB layer (Supabase when configured, in-memory
// fallback otherwise), so the queue and every getLeadById lookup read from the
// exact same source — no more "lead not found".
// ─────────────────────────────────────────────────────────────────────────────

export function getDialQueue(): Promise<Lead[]> {
  return dbDialQueue();
}
