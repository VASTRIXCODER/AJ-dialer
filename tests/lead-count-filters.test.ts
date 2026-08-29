import { describe, expect, it } from "vitest";
import type { LeadCountKey } from "@/components/leads/lead-counts-row";
import {
  buildCountFilter,
  decodeFilterParam,
  encodeFilterParam,
  sanitizeFilterSpec,
  type LeadCountFilterKey,
} from "@/lib/leads/filter-spec";

// ─────────────────────────────────────────────────────────────────────────────
// buildCountFilter is the bridge from a LeadCounts tile to the typed-filter
// grammar: clicking a tile must land on a ?f= whose rows are counted by the
// same predicate the tile displayed. These tests pin (a) the key set to the
// tile row's keys, (b) sanitize-stability (the sanitizer must accept every
// generated spec UNCHANGED — a dropped condition would silently widen the
// drilldown), and (c) URL round-tripping, since the specs travel as ?f=.
// ─────────────────────────────────────────────────────────────────────────────

// COMPILE-TIME: the builder's key union and the tile row's key union are the
// same set, both directions.
const _tileKeysAccepted: LeadCountFilterKey extends LeadCountKey ? true : false = true;
const _builderKeysAccepted: LeadCountKey extends LeadCountFilterKey ? true : false = true;
void _tileKeysAccepted;
void _builderKeysAccepted;

const ALL_KEYS: LeadCountFilterKey[] = [
  "active",
  "dialEligible",
  "assigned",
  "unassigned",
  "neverDialed",
  "attempted",
  "dnc",
  "archived",
];

const FILTERED_KEYS = ALL_KEYS.filter((k) => k !== "active");

describe("buildCountFilter", () => {
  it("'active' is the empty filter (bare /leads, no ?f=)", () => {
    expect(buildCountFilter("active")).toBeNull();
  });

  it("every other tile produces a single-condition spec", () => {
    for (const key of FILTERED_KEYS) {
      const spec = buildCountFilter(key);
      expect(spec, key).not.toBeNull();
      expect(spec!.groups.length, key).toBe(1);
      expect(spec!.groups[0].conditions.length, key).toBe(1);
    }
  });

  it("every generated spec is sanitize-stable (nothing dropped or rewritten)", () => {
    for (const key of FILTERED_KEYS) {
      const spec = buildCountFilter(key)!;
      expect(sanitizeFilterSpec(spec), key).toEqual(spec);
    }
  });

  it("every generated spec survives the ?f= round trip", () => {
    for (const key of FILTERED_KEYS) {
      const spec = buildCountFilter(key)!;
      const param = encodeFilterParam(spec);
      expect(param.length, key).toBeGreaterThan(0);
      expect(decodeFilterParam(param), key).toEqual(spec);
    }
  });

  it("derived predicates are stamped kind 'derived', column reads 'core'", () => {
    expect(buildCountFilter("dialEligible")!.groups[0].conditions[0]).toMatchObject({
      kind: "derived",
      key: "dial_eligible",
      cmp: "is_true",
    });
    expect(buildCountFilter("assigned")!.groups[0].conditions[0]).toMatchObject({
      kind: "core",
      key: "assigned_rep_id",
      cmp: "not_empty",
    });
    expect(buildCountFilter("attempted")!.groups[0].conditions[0]).toMatchObject({
      kind: "core",
      key: "attempt_count",
      cmp: "gt",
      value: 0,
    });
  });
});
