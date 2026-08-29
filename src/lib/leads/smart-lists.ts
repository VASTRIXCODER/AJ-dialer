import type { Lead } from "../types";
import type { FilterSpec } from "./filter-spec";
import { isValidPhone } from "../utils";
import { DIALABLE_STATUSES } from "./dialable";

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY smart lists — now ONLY two jobs, neither of them the product:
//
//   1. The DEMO FALLBACK. Real smart lists are rows in the `smart_lists` table
//      (supabase/schema.sql PART 30 — FilterSpec jsonb, per-org, editable),
//      read through src/lib/db/smart-lists.ts. When Supabase is unconfigured,
//      that module rebuilds the seeded lists from SMART_LISTS +
//      SEEDED_SMART_LIST_FILTERS below, so the chips row never goes blank.
//   2. The p_smart SQL MIRROR. app_leads_page (schema.sql) still accepts a
//      legacy `?smart=` key and compiles it with its own CASE arms; the match()
//      rules here are the TS twins those arms must agree with. The leads page
//      now translates `?smart=` into the DB list's FilterSpec server-side, so
//      this path only runs for callers that bypass that translation.
//
// SEEDED_SMART_LIST_FILTERS is the TS copy of the PART 30 seed jsonb —
// tests/smart-list-migration.test.ts parses schema.sql and pins the two
// byte-for-byte, and pins that each spec's evaluateFilter membership matches
// the corresponding match() rule. Edit the seeds in BOTH places or that test
// fails.
//
// Do not add lists here: create rows (Admin, or "Save as list…" on /leads).
// ─────────────────────────────────────────────────────────────────────────────

export type SmartListTone = "success" | "warning" | "danger" | "accent" | "primary" | "neutral";

export interface SmartList {
  id: string;
  label: string;
  description: string;
  tone: SmartListTone;
  match: (lead: Lead, now?: number) => boolean;
}

const DAY = 86_400_000;
// Statuses still in play for outreach — the shared list, not a mirror of it.
const DIALABLE: ReadonlySet<string> = new Set(DIALABLE_STATUSES);

export const SMART_LISTS: SmartList[] = [
  {
    id: "high_bill",
    label: "High bill",
    description: "Utility bill $200+/mo — the strongest savings pitch.",
    tone: "success",
    match: (l) => (l.utilityBill ?? 0) >= 200,
  },
  {
    id: "big_load",
    label: "Big home load",
    description: "EV, pool, battery, or multiple systems — high energy use.",
    tone: "accent",
    match: (l) => Boolean(l.hasEV || l.hasPool || l.hasBattery || l.multipleSystems),
  },
  {
    id: "fresh",
    label: "Never called",
    description: "New leads that haven't been contacted yet.",
    tone: "primary",
    match: (l) => l.status === "new" && !l.lastContactedAt,
  },
  {
    id: "going_cold",
    label: "Going cold",
    description: "Still dialable but no contact in 14+ days — re-engage before they go stale.",
    tone: "warning",
    match: (l, now = Date.now()) =>
      DIALABLE.has(l.status) &&
      Boolean(l.lastContactedAt) &&
      now - new Date(l.lastContactedAt as string).getTime() >= 14 * DAY,
  },
  {
    id: "no_phone",
    label: "No valid phone",
    description: "Can't be dialed — needs a corrected number.",
    tone: "danger",
    match: (l) => !isValidPhone(l.phone),
  },
  {
    id: "missing_address",
    label: "Missing address",
    description: "No street or city on file — fill the gap before the call.",
    tone: "warning",
    match: (l) => !l.address?.trim() && !l.city?.trim(),
  },
];

/** The keys schema.sql PART 30 seeds per org (solar orgs get all six). */
export type SeededSmartListKey =
  | "fresh"
  | "going_cold"
  | "no_phone"
  | "missing_address"
  | "high_bill"
  | "big_load";

/**
 * TS mirror of the PART 30 seed jsonb — one FilterSpec per seeded key, every
 * one sanitize-stable. The demo fallback in db/smart-lists.ts serves these;
 * the migration test pins them to schema.sql and to the match() rules above.
 */
export const SEEDED_SMART_LIST_FILTERS: Record<SeededSmartListKey, FilterSpec> = {
  fresh: {
    op: "and",
    groups: [
      {
        op: "and",
        conditions: [
          { kind: "core", key: "status", cmp: "eq", value: "new" },
          { kind: "derived", key: "never_dialed", cmp: "is_true" },
        ],
      },
    ],
  },
  going_cold: {
    op: "and",
    groups: [
      {
        op: "and",
        conditions: [
          { kind: "core", key: "status", cmp: "in", value: ["new", "no_answer", "callback"] },
          { kind: "core", key: "last_contacted_at", cmp: "older_than_days", value: 14 },
        ],
      },
    ],
  },
  no_phone: {
    op: "and",
    groups: [
      {
        op: "and",
        conditions: [{ kind: "derived", key: "phone_valid", cmp: "is_false" }],
      },
    ],
  },
  missing_address: {
    op: "and",
    groups: [
      {
        op: "and",
        conditions: [
          { kind: "core", key: "address", cmp: "is_empty" },
          { kind: "core", key: "city", cmp: "is_empty" },
        ],
      },
    ],
  },
  high_bill: {
    op: "and",
    groups: [
      {
        op: "and",
        conditions: [{ kind: "core", key: "utility_bill", cmp: "gte", value: 200 }],
      },
    ],
  },
  big_load: {
    op: "and",
    groups: [
      {
        op: "or",
        conditions: [
          { kind: "core", key: "has_ev", cmp: "is_true" },
          { kind: "core", key: "has_pool", cmp: "is_true" },
          { kind: "core", key: "has_battery", cmp: "is_true" },
          { kind: "core", key: "multiple_systems", cmp: "is_true" },
        ],
      },
    ],
  },
};

export function smartListById(id: string): SmartList | undefined {
  return SMART_LISTS.find((s) => s.id === id);
}

/** Count how many of `leads` fall into each smart list (for the filter chips). */
export function countSmartLists(leads: Lead[], now = Date.now()): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sl of SMART_LISTS) counts[sl.id] = 0;
  for (const l of leads) {
    for (const sl of SMART_LISTS) if (sl.match(l, now)) counts[sl.id]++;
  }
  return counts;
}
