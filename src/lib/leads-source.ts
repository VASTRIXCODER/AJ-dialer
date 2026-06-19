import "server-only";
import type { Lead } from "./types";
import { realLeads } from "./real-leads";

// ─────────────────────────────────────────────────────────────────────────────
// Lead source for the dialer queue.
//
// Returns the next batch of leads ready to dial, ordered by priority.
// Replace with a DB query once your backend is wired up.
// ─────────────────────────────────────────────────────────────────────────────

const DIALABLE: Lead["status"][] = ["new", "no_answer", "callback"];

export async function getDialQueue(): Promise<Lead[]> {
  return realLeads
    .filter((l) => DIALABLE.includes(l.status) && l.phone)
    .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));
}
