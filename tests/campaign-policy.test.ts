import { describe, expect, it } from "vitest";
import {
  emptyFunnel,
  filterCallerIds,
  filterDispositionKeys,
  FUNNEL_STAGES,
  parseFunnel,
  sanitizeAudience,
  sanitizeCampaignWindows,
  sanitizeDialingModes,
  sanitizeDialingPolicy,
  sanitizeGoals,
  sanitizeRetryPolicy,
  stageFilter,
} from "@/lib/campaign-policy";
import { sanitizeFilterSpec } from "@/lib/leads/filter-spec";

// ─────────────────────────────────────────────────────────────────────────────
// Campaign policy (D4): the pure validators behind PATCH /api/campaigns and
// the funnel→FilterSpec drilldown mapping. The drill specs MUST be
// sanitize-stable — a segment link that the /leads sanitizer would rewrite
// (or drop) shows different rows than the number it advertised.
// ─────────────────────────────────────────────────────────────────────────────

describe("sanitizeDialingModes", () => {
  it("keeps only valid modes, deduped, in canonical order", () => {
    expect(sanitizeDialingModes(["ai", "manual", "ai", "predictive", 42])).toEqual([
      "manual",
      "ai",
    ]);
  });

  it("returns [] for non-arrays and empty input", () => {
    expect(sanitizeDialingModes(undefined)).toEqual([]);
    expect(sanitizeDialingModes("ai")).toEqual([]);
    expect(sanitizeDialingModes([])).toEqual([]);
  });
});

describe("sanitizeCampaignWindows", () => {
  it("keeps valid windows and drops inverted / out-of-range / garbage rows", () => {
    expect(
      sanitizeCampaignWindows([
        { start: 9, end: 12 },
        { start: 12, end: 9 }, // inverted
        { start: -1, end: 5 }, // start clamps to 0 → valid
        { start: 8, end: 8 }, // empty window
        "nope",
        { start: "9", end: 12 }, // non-numeric start
      ]),
    ).toEqual([
      { start: 9, end: 12 },
      { start: 0, end: 5 },
    ]);
  });

  it("caps at 8 windows", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ start: i, end: i + 1 }));
    expect(sanitizeCampaignWindows(many)).toHaveLength(8);
  });
});

describe("sanitizeDialingPolicy", () => {
  it("returns null for non-objects (column null = no policy)", () => {
    expect(sanitizeDialingPolicy(null)).toBeNull();
    expect(sanitizeDialingPolicy("x")).toBeNull();
    expect(sanitizeDialingPolicy([1])).toBeNull();
  });

  it("normalizes a full policy, clamping and rounding pacing", () => {
    expect(
      sanitizeDialingPolicy({
        modes: ["ai"],
        windows: [{ start: 9, end: 17 }],
        timezone: "  America/Chicago  ",
        pacing: { callsPerRun: 7.6, maxConcurrent: 900 },
      }),
    ).toEqual({
      modes: ["ai"],
      windows: [{ start: 9, end: 17 }],
      timezone: "America/Chicago",
      pacing: { callsPerRun: 8, maxConcurrent: 100 },
    });
  });

  it("defaults missing parts to inherit-from-org (0s, empties)", () => {
    expect(sanitizeDialingPolicy({})).toEqual({
      modes: [],
      windows: [],
      timezone: "",
      pacing: { callsPerRun: 0, maxConcurrent: 0 },
    });
  });
});

describe("sanitizeRetryPolicy", () => {
  it("returns integer gates, clamped to sane ranges", () => {
    expect(sanitizeRetryPolicy({ maxAttempts: 5.4, cooldownHours: -3 })).toEqual({
      maxAttempts: 5,
      cooldownHours: 0,
    });
    expect(sanitizeRetryPolicy({ maxAttempts: 1000, cooldownHours: 10_000 })).toEqual({
      maxAttempts: 99,
      cooldownHours: 720,
    });
  });

  it("treats non-numeric knobs as off (0) and non-objects as no policy", () => {
    expect(sanitizeRetryPolicy({ maxAttempts: "6" })).toEqual({
      maxAttempts: 0,
      cooldownHours: 0,
    });
    expect(sanitizeRetryPolicy(null)).toBeNull();
  });
});

describe("filterCallerIds", () => {
  const pool = ["+15551110001", "+15551110002", "+15551110003"];

  it("keeps only numbers in the org pool, in pool order", () => {
    expect(
      filterCallerIds(["+15551110003", "+19998887777", "+15551110001", 7], pool),
    ).toEqual(["+15551110001", "+15551110003"]);
  });

  it("returns [] for non-arrays and for an empty pool", () => {
    expect(filterCallerIds("x", pool)).toEqual([]);
    expect(filterCallerIds(["+15551110001"], [])).toEqual([]);
  });
});

describe("filterDispositionKeys", () => {
  const valid = ["appointment_booked", "do_not_call", "bills_fine", "x_spoke_to_spouse"];

  it("keeps only keys the resolved disposition set has", () => {
    expect(
      filterDispositionKeys(["bills_fine", "x_spoke_to_spouse", "made_up", 1], valid),
    ).toEqual(["bills_fine", "x_spoke_to_spouse"]);
  });

  it("returns [] (= all dispositions) for garbage", () => {
    expect(filterDispositionKeys(undefined, valid)).toEqual([]);
  });
});

describe("sanitizeAudience", () => {
  it("passes a valid filter audience through, sanitized", () => {
    const aud = sanitizeAudience({
      kind: "filter",
      filter: {
        op: "and",
        groups: [
          { op: "and", conditions: [{ kind: "core", key: "city", cmp: "eq", value: "Fresno" }] },
        ],
      },
    });
    expect(aud?.kind).toBe("filter");
    expect(aud?.filter?.groups[0].conditions[0]).toMatchObject({ key: "city", value: "Fresno" });
  });

  it("degrades a filter audience with no valid conditions to kind:all", () => {
    expect(sanitizeAudience({ kind: "filter", filter: { op: "and", groups: [] } })).toEqual({
      kind: "all",
    });
  });

  it("degrades a smart_list audience without an id to kind:all", () => {
    expect(sanitizeAudience({ kind: "smart_list" })).toEqual({ kind: "all" });
    expect(sanitizeAudience({ kind: "smart_list", smartListId: "abc" })).toEqual({
      kind: "smart_list",
      smartListId: "abc",
    });
  });

  it("rejects unknown kinds and non-objects", () => {
    expect(sanitizeAudience({ kind: "everyone" })).toBeNull();
    expect(sanitizeAudience("all")).toBeNull();
  });
});

describe("sanitizeGoals", () => {
  it("keeps positive integer goals and drops the rest", () => {
    expect(sanitizeGoals({ appointments: 20.4, connects: 0, periodDays: 30 })).toEqual({
      appointments: 20,
      periodDays: 30,
    });
  });

  it("returns null when nothing survives", () => {
    expect(sanitizeGoals({ appointments: "20" })).toBeNull();
    expect(sanitizeGoals(null)).toBeNull();
  });
});

describe("funnel parsing", () => {
  it("reads the RPC jsonb and zero-fills anything missing or bogus", () => {
    const f = parseFunnel({ eligible: 12, connected: "9", dnc: -3, total: 30 });
    expect(f.eligible).toBe(12);
    expect(f.connected).toBe(9); // numeric string coerces
    expect(f.dnc).toBe(0); // negative rejected
    expect(f.attempted).toBe(0);
    expect(f.total).toBe(30);
  });

  it("returns all zeros for garbage (the demo fallback)", () => {
    expect(parseFunnel(null)).toEqual(emptyFunnel());
  });
});

describe("stageFilter", () => {
  const CID = "11111111-2222-3333-4444-555555555555";

  it("every stage produces a sanitize-STABLE spec that pins the campaign", () => {
    for (const stage of FUNNEL_STAGES) {
      const spec = stageFilter(CID, stage, { maxAttempts: 4 });
      // Stability: what /leads runs is byte-for-byte what the link encoded.
      expect(sanitizeFilterSpec(spec), `stage ${stage} must be sanitize-stable`).toEqual(spec);
      // The campaign pin is always present.
      const conditions = spec.groups.flatMap((g) => g.conditions);
      expect(
        conditions.some(
          (c) => c.key === "campaign_id" && c.cmp === "eq" && "value" in c && c.value === CID,
        ),
        `stage ${stage} must pin the campaign`,
      ).toBe(true);
    }
  });

  it("maps the status-shaped stages to their stored status keys", () => {
    const statusOf = (stage: "callback" | "appointment" | "converted") => {
      const c = stageFilter(CID, stage).groups[0].conditions[1];
      return "value" in c ? c.value : undefined;
    };
    expect(statusOf("callback")).toBe("callback");
    expect(statusOf("appointment")).toBe("appointment");
    expect(statusOf("converted")).toBe("qualified");
  });

  it("attempted drills into attempt_count > 0", () => {
    expect(stageFilter(CID, "attempted").groups[0].conditions[1]).toMatchObject({
      key: "attempt_count",
      cmp: "gt",
      value: 0,
    });
  });

  it("exhausted uses the campaign's maxAttempts when known, gt-0 otherwise", () => {
    expect(stageFilter(CID, "exhausted", { maxAttempts: 4 }).groups[0].conditions[1]).toMatchObject(
      { key: "attempt_count", cmp: "gte", value: 4 },
    );
    expect(stageFilter(CID, "exhausted").groups[0].conditions[1]).toMatchObject({
      key: "attempt_count",
      cmp: "gt",
      value: 0,
    });
  });

  it("dnc and excluded drill into the derived predicates", () => {
    expect(stageFilter(CID, "dnc").groups[0].conditions[1]).toMatchObject({
      kind: "derived",
      key: "dnc",
      cmp: "is_true",
    });
    const excluded = stageFilter(CID, "excluded");
    expect(excluded.groups).toHaveLength(2);
    expect(excluded.groups[1].op).toBe("or");
    expect(excluded.groups[1].conditions.map((c) => c.key)).toEqual([
      "archived",
      "phone_valid",
    ]);
  });

  it("connected approximates the call-derived bucket via latest_outcome", () => {
    const cond = stageFilter(CID, "connected").groups[0].conditions[1];
    expect(cond).toMatchObject({ kind: "derived", key: "latest_outcome", cmp: "in" });
    expect("value" in cond && cond.value).toContain("appointment_booked");
  });
});
