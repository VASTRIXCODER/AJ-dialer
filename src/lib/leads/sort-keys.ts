// ─────────────────────────────────────────────────────────────────────────────
// The Leads-tab sort whitelist — THE single source on the TypeScript side.
//
// This exact key list used to be triplicated: the URL parser in
// app/(app)/leads/page.tsx, the JS mirror (LEADS_SORT_VALUES) in db/leads.ts,
// and the CASE arms of app_leads_page in supabase/schema.sql. The first two now
// derive from here; the SQL copy CANNOT and stays behind in schema.sql with its
// own lockstep comment — adding a key here means adding a CASE arm there too.
//
// Keys are STORED identifiers, not labels: `utility_bill` and `solar_payment`
// name live columns and appear in bookmarked `?sort=` URLs, so they never
// change even though the words a human sees come from the org's vocabulary.
// ─────────────────────────────────────────────────────────────────────────────

export const LEAD_SORT_KEYS = [
  "name",
  "city",
  "state",
  "status",
  "utility_bill",
  "solar_payment",
  "ai_score",
  "last_contacted_at",
  "created_at",
] as const;

export type LeadSortKey = (typeof LEAD_SORT_KEYS)[number];

/** True when `s` is a key app_leads_page's CASE whitelist accepts. */
export function isLeadSortKey(s: string): s is LeadSortKey {
  return (LEAD_SORT_KEYS as readonly string[]).includes(s);
}
