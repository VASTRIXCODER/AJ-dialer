import type { LeadStatus } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Which statuses are still in play for outreach — THE single source.
//
// This list used to be defined independently in three places (db/leads.ts,
// campaign-stats.ts, leads/smart-lists.ts) and they only agreed by luck: one
// stray edit and "dialable" would have meant different things to the dial
// queue, the campaign stats, and the smart lists, with no error anywhere.
//
// The SQL twin — the status filter inside app_leads_page (supabase/schema.sql)
// — must stay in lockstep with this list. The dialer's own default is derived,
// not duplicated: dialer/segments.ts marks exactly these statuses tier
// "default", and tests/dialable.test.ts pins the two together.
// ─────────────────────────────────────────────────────────────────────────────

export const DIALABLE_STATUSES: readonly LeadStatus[] = ["new", "no_answer", "callback"];

const DIALABLE_SET: ReadonlySet<string> = new Set(DIALABLE_STATUSES);

/** True when `s` is a status the dialer may still call by default. */
export function isDialableStatus(s: string): boolean {
  return DIALABLE_SET.has(s);
}
