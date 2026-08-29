import { describe, expect, it } from "vitest";
import {
  LEAD_COUNT_DEFINITIONS,
  type LeadCountKey,
} from "@/components/leads/lead-counts-row";
import type { LeadCounts } from "@/lib/db/leads-filter";

// ─────────────────────────────────────────────────────────────────────────────
// The tile definitions are a three-way contract: the LeadCounts shape
// (db/leads-filter.ts), the app_lead_counts SQL, and the glossary wording in
// docs/phase-1/metric-glossary.md § "Lead counts". These assertions pin the
// definitions map to the count shape and to the glossary's tile names, so a
// renamed key or a silently-dropped tile fails a test instead of shipping a
// row of unlabeled numbers.
// ─────────────────────────────────────────────────────────────────────────────

// COMPILE-TIME completeness, both directions: every LeadCounts key has a
// definition, and the definitions map has no key LeadCounts lacks.
const _everyCountDefined: Record<keyof LeadCounts, { label: string; definition: string }> =
  LEAD_COUNT_DEFINITIONS;
const _noExtraKeys: [Exclude<LeadCountKey, keyof LeadCounts>] extends [never] ? true : false =
  true;
void _everyCountDefined;
void _noExtraKeys;

const EXPECTED_KEYS: LeadCountKey[] = [
  "active",
  "dialEligible",
  "assigned",
  "unassigned",
  "neverDialed",
  "attempted",
  "dnc",
  "archived",
];

describe("LEAD_COUNT_DEFINITIONS", () => {
  it("covers exactly the 8 lead-count tiles", () => {
    expect(Object.keys(LEAD_COUNT_DEFINITIONS).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it("every entry has a non-empty label and definition", () => {
    for (const key of EXPECTED_KEYS) {
      const def = LEAD_COUNT_DEFINITIONS[key];
      expect(def.label.trim().length, key).toBeGreaterThan(0);
      expect(def.definition.trim().length, key).toBeGreaterThan(10);
    }
  });

  it("labels and definitions are mutually distinct", () => {
    const labels = EXPECTED_KEYS.map((k) => LEAD_COUNT_DEFINITIONS[k].label);
    const defs = EXPECTED_KEYS.map((k) => LEAD_COUNT_DEFINITIONS[k].definition);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(defs).size).toBe(defs.length);
  });

  it("labels match the glossary's tile names", () => {
    // docs/phase-1/metric-glossary.md § "Lead counts" — the source of truth.
    expect(LEAD_COUNT_DEFINITIONS.active.label).toBe("All active");
    expect(LEAD_COUNT_DEFINITIONS.dialEligible.label).toBe("Dial-eligible");
    expect(LEAD_COUNT_DEFINITIONS.assigned.label).toBe("Assigned");
    expect(LEAD_COUNT_DEFINITIONS.unassigned.label).toBe("Unassigned");
    expect(LEAD_COUNT_DEFINITIONS.neverDialed.label).toBe("Never dialed");
    expect(LEAD_COUNT_DEFINITIONS.attempted.label).toBe("Previously attempted");
    expect(LEAD_COUNT_DEFINITIONS.dnc.label).toBe("DNC / suppressed");
    expect(LEAD_COUNT_DEFINITIONS.archived.label).toBe("Archived / invalid");
  });

  it("definitions carry the glossary's load-bearing terms", () => {
    expect(LEAD_COUNT_DEFINITIONS.active.definition).toMatch(/archived/i);
    expect(LEAD_COUNT_DEFINITIONS.active.definition).toMatch(/DNC/);
    expect(LEAD_COUNT_DEFINITIONS.dialEligible.definition).toMatch(/eligib/i);
    expect(LEAD_COUNT_DEFINITIONS.neverDialed.definition).toMatch(/attempt/i);
    expect(LEAD_COUNT_DEFINITIONS.attempted.definition).toMatch(/attempt/i);
    expect(LEAD_COUNT_DEFINITIONS.dnc.definition).toMatch(/do-not-call/i);
    expect(LEAD_COUNT_DEFINITIONS.archived.definition).toMatch(/phone/i);
  });
});
