import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leadToFilterShape } from "@/lib/db/leads-filter";
import {
  evaluateFilter,
  sanitizeFilterSpec,
  type FilterContext,
  type FilterSpec,
} from "@/lib/leads/filter-spec";
import {
  SEEDED_SMART_LIST_FILTERS,
  smartListById,
  type SeededSmartListKey,
} from "@/lib/leads/smart-lists";
import type { Lead } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Smart Lists 2.0 migration contract.
//
// The six legacy hardcoded rules became per-org rows seeded by schema.sql
// PART 30 as FilterSpec jsonb. Three things must hold or the migration lied:
//   1. The seed jsonb IN THE SQL FILE parses, is sanitize-stable (the TS
//      sanitizer accepts it UNCHANGED — a dropped condition silently widens a
//      list), and matches the TS mirror the demo fallback serves.
//   2. Each seeded spec, run through evaluateFilter over a shared fixture,
//      produces the SAME membership as the legacy match() rule it replaced.
//   3. That parity covers all six keys — the solar pair included, since the
//      legacy module never gated them.
// ─────────────────────────────────────────────────────────────────────────────

const SEED_KEYS: SeededSmartListKey[] = [
  "fresh",
  "going_cold",
  "no_phone",
  "missing_address",
  "high_bill",
  "big_load",
];

/** Parse the PART 30 seed tuples straight out of schema.sql: the 5-column
 *  VALUES rows whose last column is a '{"op":…}' jsonb literal. */
function seedSpecsFromSchema(): Map<string, FilterSpec> {
  const sql = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf8");
  const re =
    /\('([a-z_]+)',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*'[a-z]+',\s*'(\{"op":[^']*\})'\)/g;
  const specs = new Map<string, FilterSpec>();
  for (const m of sql.matchAll(re)) {
    specs.set(m[1], JSON.parse(m[2]) as FilterSpec);
  }
  return specs;
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const CTX: FilterContext = { now: new Date(NOW) };
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function mkLead(id: string, over: Partial<Lead> = {}): Lead {
  return {
    id,
    firstName: "Fixture",
    lastName: id.toUpperCase(),
    phone: "(559) 555-0100",
    address: "1 Main St",
    city: "Fresno",
    state: "CA",
    zip: "93701",
    utilityProvider: "PG&E",
    solarProvider: "",
    status: "new",
    campaignId: "camp-1",
    hasEV: false,
    hasPool: false,
    hasBattery: false,
    multipleSystems: false,
    timezone: "America/Los_Angeles",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

// The shared 12-lead fixture. Deliberately realistic: contacted leads carry
// lastContactedAt (which is also what the attempt columns approximate from),
// phones are either clean 10-digit numbers or plainly undialable, and no
// lead sits exactly ON the 14-day going-cold boundary (the legacy rule was
// >=, the filter grammar's older_than_days is >, and real book data doesn't
// land on the exact millisecond).
const FIXTURE: Lead[] = [
  // Never contacted, big bill → fresh + high_bill.
  mkLead("l1", { utilityBill: 250 }),
  // Never contacted, modest bill → fresh only.
  mkLead("l2", { utilityBill: 120 }),
  // New but contacted 3 days ago → neither fresh nor going cold.
  mkLead("l3", { lastContactedAt: daysAgo(3) }),
  // Still-dialable statuses gone quiet → going_cold.
  mkLead("l4", { status: "no_answer", lastContactedAt: daysAgo(20) }),
  mkLead("l5", { status: "callback", lastContactedAt: daysAgo(15) }),
  // Long quiet but no longer dialable → NOT going_cold; multi-system home.
  mkLead("l6", {
    status: "appointment",
    lastContactedAt: daysAgo(30),
    multipleSystems: true,
  }),
  // Undialable phones → no_phone.
  mkLead("l7", { phone: "", status: "contacted", lastContactedAt: daysAgo(2) }),
  mkLead("l8", { phone: "123", status: "contacted", lastContactedAt: daysAgo(2) }),
  // No street or city on file → missing_address.
  mkLead("l9", {
    address: "",
    city: "",
    status: "contacted",
    lastContactedAt: daysAgo(2),
  }),
  // Street missing but city present → NOT missing_address.
  mkLead("l10", {
    address: "",
    status: "qualified",
    lastContactedAt: daysAgo(1),
  }),
  // Big-load homes → big_load (one per OR arm beyond l6's).
  mkLead("l11", { hasEV: true, status: "qualified", lastContactedAt: daysAgo(1) }),
  mkLead("l12", {
    hasPool: true,
    hasBattery: true,
    utilityBill: 300,
    status: "no_answer",
    lastContactedAt: daysAgo(20),
  }),
];

const legacyMembers = (key: string): string[] => {
  const list = smartListById(key);
  if (!list) throw new Error(`legacy list missing: ${key}`);
  return FIXTURE.filter((l) => list.match(l, NOW)).map((l) => l.id);
};

const specMembers = (spec: FilterSpec): string[] =>
  FIXTURE.filter((l) => evaluateFilter(leadToFilterShape(l), spec, CTX)).map(
    (l) => l.id,
  );

describe("smart-list seed specs (schema.sql PART 30)", () => {
  const schemaSpecs = seedSpecsFromSchema();

  it("schema.sql seeds exactly the six legacy keys", () => {
    expect([...schemaSpecs.keys()].sort()).toEqual([...SEED_KEYS].sort());
  });

  it("every seed is sanitize-stable — nothing dropped, nothing rewritten", () => {
    for (const key of SEED_KEYS) {
      const spec = schemaSpecs.get(key)!;
      expect(sanitizeFilterSpec(spec), key).toEqual(spec);
    }
  });

  it("the TS mirror (demo fallback) matches the SQL seeds byte-for-byte", () => {
    for (const key of SEED_KEYS) {
      expect(SEEDED_SMART_LIST_FILTERS[key], key).toEqual(schemaSpecs.get(key));
    }
  });

  it("each seeded FilterSpec selects the same fixture members as the legacy rule", () => {
    for (const key of SEED_KEYS) {
      const spec = schemaSpecs.get(key)!;
      expect(specMembers(spec).sort(), key).toEqual(legacyMembers(key).sort());
    }
  });

  it("the fixture actually exercises every list (no vacuous parity)", () => {
    for (const key of SEED_KEYS) {
      expect(legacyMembers(key).length, key).toBeGreaterThan(0);
    }
  });
});
