import { describe, expect, it } from "vitest";
import {
  DERIVED_FILTER_KEYS,
  evaluateFilter,
  sanitizeFilterSpec,
} from "@/lib/leads/filter-spec";
import type {
  FilterCmp,
  FilterCondition,
  FilterFieldKey,
  FilterSpec,
  FilterValue,
  LeadForFilter,
} from "@/lib/leads/filter-spec";
import type { LeadFieldType } from "@/lib/leads/field-schema";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders. NOW is frozen so every date expectation is hand-computable.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-28T12:00:00.000Z");
const DNC = new Set(["5595550999"]);
const CTX = { now: NOW, dncDigits: DNC };

function mkLead(id: string, over: Partial<LeadForFilter> = {}): LeadForFilter {
  return {
    id,
    firstName: "Lead",
    lastName: id.toUpperCase(),
    city: "Fresno",
    state: "CA",
    county: "Fresno",
    zip: "93701",
    timezone: "America/Los_Angeles",
    status: "new",
    campaignId: "camp-1",
    leadGroup: "fresno",
    leadPackId: null,
    assignedRepId: "rep-1",
    ownerId: "owner-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastContactedAt: null,
    utilityBill: 150,
    solarPayment: null,
    hasEV: false,
    hasPool: false,
    hasBattery: false,
    multipleSystems: false,
    customFields: {},
    phoneDigits: "5595550100",
    attemptCount: 0,
    lastAttemptAt: null,
    latestOutcome: null,
    hasOpenCallback: false,
    hasScheduledAppointment: false,
    archivedAt: null,
    importJobId: null,
    sourceFile: null,
    dialingPreference: null,
    nextEligibleAt: null,
    ...over,
  };
}

const core = (key: FilterFieldKey, cmp: FilterCmp, value?: FilterValue): FilterCondition => ({
  kind: DERIVED_FILTER_KEYS.has(key) ? "derived" : "core",
  key,
  cmp,
  ...(value === undefined ? {} : { value }),
});

const custom = (
  key: string,
  type: LeadFieldType,
  cmp: FilterCmp,
  value?: FilterValue,
): FilterCondition => ({
  kind: "custom",
  key,
  type,
  cmp,
  ...(value === undefined ? {} : { value }),
});

const grp = (op: "and" | "or", ...conditions: FilterCondition[]) => ({ op, conditions });
const spec = (op: "and" | "or", ...groups: ReturnType<typeof grp>[]): FilterSpec => ({
  op,
  groups,
});

/** One AND group — the shape most unit assertions need. */
function run(lead: LeadForFilter, ...conditions: FilterCondition[]): boolean {
  return evaluateFilter(lead, spec("and", grp("and", ...conditions)), CTX);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-comparator semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("text comparators", () => {
  const l = mkLead("t1", { city: "Fresno", state: "CA" });
  const empty = mkLead("t2", { city: "", county: null });

  it("eq / neq are exact and case-sensitive", () => {
    expect(run(l, core("city", "eq", "Fresno"))).toBe(true);
    expect(run(l, core("city", "eq", "fresno"))).toBe(false);
    expect(run(l, core("city", "neq", "Houston"))).toBe(true);
    expect(run(l, core("city", "neq", "Fresno"))).toBe(false);
  });

  it("in / nin are set membership", () => {
    expect(run(l, core("state", "in", ["CA", "TX"]))).toBe(true);
    expect(run(l, core("state", "in", ["TX"]))).toBe(false);
    expect(run(l, core("state", "nin", ["TX"]))).toBe(true);
    expect(run(l, core("state", "nin", ["CA", "TX"]))).toBe(false);
  });

  it("contains / starts_with are case-insensitive", () => {
    expect(run(l, core("city", "contains", "RESN"))).toBe(true);
    expect(run(l, core("city", "contains", "houston"))).toBe(false);
    expect(run(l, core("zip", "starts_with", "937"))).toBe(true);
    expect(run(l, core("zip", "starts_with", "770"))).toBe(false);
  });

  it("is_empty / not_empty treat null and '' alike", () => {
    expect(run(empty, core("city", "is_empty"))).toBe(true);
    expect(run(empty, core("county", "is_empty"))).toBe(true);
    expect(run(l, core("city", "is_empty"))).toBe(false);
    expect(run(l, core("city", "not_empty"))).toBe(true);
    expect(run(empty, core("city", "not_empty"))).toBe(false);
  });
});

describe("enum comparators", () => {
  const l = mkLead("e1", { status: "callback", latestOutcome: "callback_scheduled" });

  it("eq / neq / in / nin over stored keys", () => {
    expect(run(l, core("status", "eq", "callback"))).toBe(true);
    expect(run(l, core("status", "neq", "new"))).toBe(true);
    expect(run(l, core("status", "in", ["new", "callback"]))).toBe(true);
    expect(run(l, core("status", "nin", ["dnc", "not_interested"]))).toBe(true);
    expect(run(l, core("latest_outcome", "eq", "callback_scheduled"))).toBe(true);
    expect(run(l, core("latest_outcome", "in", ["bills_fine"]))).toBe(false);
  });

  it("null enum reads as empty", () => {
    const fresh = mkLead("e2");
    expect(run(fresh, core("latest_outcome", "is_empty"))).toBe(true);
    expect(run(fresh, core("lead_pack_id", "is_empty"))).toBe(true);
    expect(run(fresh, core("latest_outcome", "eq", "no_answer"))).toBe(false);
  });
});

describe("number comparators", () => {
  const l = mkLead("n1", { utilityBill: 210, solarPayment: 210, attemptCount: 2 });

  it("eq / neq / gt / gte / lt / lte / between", () => {
    expect(run(l, core("utility_bill", "eq", 210))).toBe(true);
    expect(run(l, core("utility_bill", "neq", 200))).toBe(true);
    expect(run(l, core("utility_bill", "gt", 200))).toBe(true);
    expect(run(l, core("utility_bill", "gt", 210))).toBe(false);
    expect(run(l, core("utility_bill", "gte", 210))).toBe(true);
    expect(run(l, core("solar_payment", "lt", 211))).toBe(true);
    expect(run(l, core("solar_payment", "lt", 210))).toBe(false);
    expect(run(l, core("solar_payment", "lte", 210))).toBe(true);
    expect(run(l, core("utility_bill", "between", [200, 280]))).toBe(true);
    expect(run(l, core("utility_bill", "between", [211, 280]))).toBe(false);
    expect(run(l, core("attempt_count", "eq", 2))).toBe(true);
    expect(run(mkLead("n0"), core("attempt_count", "eq", 0))).toBe(true);
  });

  it("a null number matches no numeric comparator — not even neq", () => {
    const noBill = mkLead("n2", { utilityBill: null });
    expect(run(noBill, core("utility_bill", "neq", 100))).toBe(false);
    expect(run(noBill, core("utility_bill", "lt", 9999))).toBe(false);
    expect(run(noBill, core("utility_bill", "is_empty"))).toBe(true);
    expect(run(noBill, core("utility_bill", "not_empty"))).toBe(false);
  });
});

describe("boolean comparators", () => {
  it("is_true / is_false on core booleans", () => {
    const ev = mkLead("b1", { hasEV: true });
    expect(run(ev, core("has_ev", "is_true"))).toBe(true);
    expect(run(ev, core("has_ev", "is_false"))).toBe(false);
    expect(run(mkLead("b2"), core("has_ev", "is_false"))).toBe(true);
    expect(run(mkLead("b3", { hasPool: true }), core("has_pool", "is_true"))).toBe(true);
    expect(run(mkLead("b4"), core("multiple_systems", "is_false"))).toBe(true);
  });

  it("custom booleans coerce import-style token strings", () => {
    const l = mkLead("b5", { customFields: { active: true, opted: "no" } });
    expect(run(l, custom("active", "boolean", "is_true"))).toBe(true);
    expect(run(l, custom("opted", "boolean", "is_false"))).toBe(true);
    expect(run(l, custom("opted", "boolean", "is_true"))).toBe(false);
  });

  it("a missing or unparseable boolean matches neither side", () => {
    const l = mkLead("b6", { customFields: { vibe: "banana" } });
    expect(run(l, custom("active", "boolean", "is_true"))).toBe(false);
    expect(run(l, custom("active", "boolean", "is_false"))).toBe(false);
    expect(run(l, custom("vibe", "boolean", "is_true"))).toBe(false);
    expect(run(l, custom("vibe", "boolean", "is_false"))).toBe(false);
  });
});

describe("date comparators", () => {
  const l = mkLead("d1", {
    createdAt: "2026-05-01T00:00:00.000Z",
    lastContactedAt: "2026-08-26T10:00:00.000Z", // 2d2h before NOW
    nextEligibleAt: "2026-09-05T00:00:00.000Z", // 7d12h after NOW
  });

  it("before / after compare parsed timestamps", () => {
    expect(run(l, core("created_at", "before", "2026-06-15T00:00:00Z"))).toBe(true);
    expect(run(l, core("created_at", "before", "2026-04-01T00:00:00Z"))).toBe(false);
    expect(run(l, core("created_at", "after", "2026-04-01T00:00:00Z"))).toBe(true);
    expect(run(l, core("created_at", "after", "2026-06-15T00:00:00Z"))).toBe(false);
  });

  it("within_days is distance from now in either direction", () => {
    expect(run(l, core("last_contacted_at", "within_days", 7))).toBe(true);
    expect(run(l, core("last_contacted_at", "within_days", 1))).toBe(false);
    // Future dates count too — "eligible within the next 10 days."
    expect(run(l, core("next_eligible_at", "within_days", 10))).toBe(true);
    expect(run(l, core("next_eligible_at", "within_days", 5))).toBe(false);
  });

  it("older_than_days is strictly in the past", () => {
    expect(run(l, core("created_at", "older_than_days", 60))).toBe(true);
    expect(run(l, core("last_contacted_at", "older_than_days", 60))).toBe(false);
    expect(run(l, core("next_eligible_at", "older_than_days", 1))).toBe(false);
  });

  it("a null date matches nothing except is_empty", () => {
    const fresh = mkLead("d2");
    expect(run(fresh, core("last_contacted_at", "before", "2027-01-01T00:00:00Z"))).toBe(false);
    expect(run(fresh, core("last_contacted_at", "within_days", 9999))).toBe(false);
    expect(run(fresh, core("last_contacted_at", "is_empty"))).toBe(true);
    expect(run(l, core("last_contacted_at", "not_empty"))).toBe(true);
  });

  it("custom dates compare the same way", () => {
    const p = mkLead("d3", { customFields: { policy_expiry: "2026-09-15" } });
    expect(run(p, custom("policy_expiry", "date", "after", "2026-09-01T00:00:00Z"))).toBe(true);
    expect(run(p, custom("policy_expiry", "date", "before", "2026-09-01T00:00:00Z"))).toBe(false);
  });
});

describe("custom field text and the numeric cast guard", () => {
  const l = mkLead("c1", {
    customFields: { plan: "Gold plan", premium: "abc", deductible: "240.5" },
  });

  it("custom text supports the full text family", () => {
    expect(run(l, custom("plan", "text", "eq", "Gold plan"))).toBe(true);
    expect(run(l, custom("plan", "text", "contains", "gold"))).toBe(true);
    expect(run(l, custom("plan", "text", "starts_with", "gold"))).toBe(true);
    expect(run(l, custom("plan", "text", "neq", "Silver plan"))).toBe(true);
    expect(run(l, custom("missing", "text", "is_empty"))).toBe(true);
  });

  it("numeric comparators over a non-numeric value match nothing (SQL guard)", () => {
    expect(run(l, custom("premium", "number", "gt", 100))).toBe(false);
    expect(run(l, custom("premium", "number", "lt", 100))).toBe(false);
    expect(run(l, custom("premium", "number", "neq", 100))).toBe(false);
    expect(run(l, custom("premium", "number", "eq", 100))).toBe(false);
    // But it is still "not empty" — the value exists, it just isn't a number.
    expect(run(l, custom("premium", "number", "not_empty"))).toBe(true);
  });

  it("numeric strings coerce cleanly", () => {
    expect(run(l, custom("deductible", "currency", "gt", 200))).toBe(true);
    expect(run(l, custom("deductible", "currency", "between", [240, 241]))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Derived keys
// ─────────────────────────────────────────────────────────────────────────────

describe("derived keys", () => {
  it("never_dialed needs zero attempts AND no attempt timestamp", () => {
    expect(run(mkLead("v1"), core("never_dialed", "is_true"))).toBe(true);
    expect(run(mkLead("v2", { attemptCount: 1 }), core("never_dialed", "is_true"))).toBe(false);
    expect(
      run(mkLead("v3", { lastAttemptAt: "2026-08-20T00:00:00Z" }), core("never_dialed", "is_true")),
    ).toBe(false);
  });

  it("dnc matches by status or by the org's digit set", () => {
    expect(run(mkLead("v4", { status: "dnc" }), core("dnc", "is_true"))).toBe(true);
    expect(run(mkLead("v5", { phoneDigits: "5595550999" }), core("dnc", "is_true"))).toBe(true);
    // The set is canonical last-10, so a 1-prefixed 11-digit number still hits.
    expect(run(mkLead("v6", { phoneDigits: "15595550999" }), core("dnc", "is_true"))).toBe(true);
    expect(run(mkLead("v7"), core("dnc", "is_false"))).toBe(true);
  });

  it("phone_valid means 10–15 digits", () => {
    expect(run(mkLead("v8"), core("phone_valid", "is_true"))).toBe(true);
    expect(run(mkLead("v9", { phoneDigits: "555010" }), core("phone_valid", "is_false"))).toBe(true);
    expect(run(mkLead("v10", { phoneDigits: "" }), core("phone_valid", "is_true"))).toBe(false);
  });

  it("unassigned and archived", () => {
    expect(run(mkLead("v11", { assignedRepId: null }), core("unassigned", "is_true"))).toBe(true);
    expect(run(mkLead("v12"), core("unassigned", "is_false"))).toBe(true);
    expect(
      run(mkLead("v13", { archivedAt: "2026-08-15T00:00:00Z" }), core("archived", "is_true")),
    ).toBe(true);
    expect(run(mkLead("v14"), core("archived", "is_false"))).toBe(true);
  });

  it("callback / appointment join flags", () => {
    expect(
      run(mkLead("v15", { hasOpenCallback: true }), core("has_open_callback", "is_true")),
    ).toBe(true);
    expect(
      run(
        mkLead("v16", { hasScheduledAppointment: true }),
        core("has_scheduled_appointment", "is_true"),
      ),
    ).toBe(true);
    expect(run(mkLead("v17"), core("has_open_callback", "is_false"))).toBe(true);
  });

  it("dial_eligible composes phone, dnc, archive, status, and snooze", () => {
    expect(run(mkLead("v18"), core("dial_eligible", "is_true"))).toBe(true);
    expect(run(mkLead("v19", { phoneDigits: "555" }), core("dial_eligible", "is_true"))).toBe(false);
    expect(
      run(mkLead("v20", { phoneDigits: "5595550999" }), core("dial_eligible", "is_true")),
    ).toBe(false);
    expect(
      run(mkLead("v21", { archivedAt: "2026-08-01T00:00:00Z" }), core("dial_eligible", "is_true")),
    ).toBe(false);
    expect(run(mkLead("v22", { status: "qualified" }), core("dial_eligible", "is_true"))).toBe(false);
    expect(
      run(mkLead("v23", { nextEligibleAt: "2026-09-05T00:00:00Z" }), core("dial_eligible", "is_true")),
    ).toBe(false);
    expect(
      run(mkLead("v24", { status: "no_answer", nextEligibleAt: "2026-08-20T00:00:00Z" }),
        core("dial_eligible", "is_true")),
    ).toBe(true);
  });

  it("search matches name, city, and phone-shaped digit queries", () => {
    const maria = mkLead("v25", { firstName: "Maria", lastName: "Gonzalez", city: "Clovis" });
    const phone = mkLead("v26", { phoneDigits: "8323334444" });
    expect(run(maria, core("search", "contains", "maria"))).toBe(true);
    expect(run(maria, core("search", "contains", "GONZ"))).toBe(true);
    expect(run(maria, core("search", "contains", "clovis"))).toBe(true);
    expect(run(mkLead("v27"), core("search", "contains", "maria"))).toBe(false);
    expect(run(phone, core("search", "contains", "(832) 333"))).toBe(true);
    expect(run(phone, core("search", "contains", "832-333"))).toBe(true);
    // A letters-and-digits query is NOT phone-shaped — no digit fallback.
    expect(run(phone, core("search", "contains", "abc1"))).toBe(false);
    // Blank matches everything, same as no condition.
    expect(run(mkLead("v28"), core("search", "contains", "  "))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AND / OR semantics at both levels
// ─────────────────────────────────────────────────────────────────────────────

describe("and/or combination", () => {
  const l = mkLead("m1", { city: "Fresno", utilityBill: 300 });
  const t = core("city", "eq", "Fresno"); // true for l
  const f = core("city", "eq", "Houston"); // false for l

  it("within one group", () => {
    expect(evaluateFilter(l, spec("and", grp("and", t, f)), CTX)).toBe(false);
    expect(evaluateFilter(l, spec("and", grp("or", t, f)), CTX)).toBe(true);
    expect(evaluateFilter(l, spec("and", grp("or", f, f)), CTX)).toBe(false);
    expect(evaluateFilter(l, spec("and", grp("and", t, core("utility_bill", "gte", 300))), CTX)).toBe(true);
  });

  it("across groups", () => {
    expect(evaluateFilter(l, spec("and", grp("and", t), grp("and", f)), CTX)).toBe(false);
    expect(evaluateFilter(l, spec("or", grp("and", t), grp("and", f)), CTX)).toBe(true);
    expect(evaluateFilter(l, spec("or", grp("and", f), grp("and", f)), CTX)).toBe(false);
    expect(evaluateFilter(l, spec("and", grp("and", t), grp("or", f, t)), CTX)).toBe(true);
  });

  it("an empty spec matches everything", () => {
    expect(evaluateFilter(l, { op: "and", groups: [] }, CTX)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TS ↔ SQL parity fixture — exported. When the SQL compiler lands, it must
// produce the same id set for every case here against these same rows.
// ─────────────────────────────────────────────────────────────────────────────

export const PARITY_NOW = NOW;
export const PARITY_DNC_DIGITS = DNC;

export const PARITY_LEADS: LeadForFilter[] = [
  mkLead("l01"),
  mkLead("l02", {
    city: "Houston", state: "TX", zip: "77002", county: "Harris",
    leadGroup: "houston", timezone: "America/Chicago", utilityBill: 220, campaignId: "camp-2",
  }),
  mkLead("l03", {
    city: "Dallas", state: "TX", zip: "75201", county: "Dallas",
    leadGroup: "dallas", utilityBill: 90, hasEV: true,
  }),
  mkLead("l04", {
    status: "contacted", attemptCount: 2,
    lastAttemptAt: "2026-08-27T15:00:00.000Z", lastContactedAt: "2026-08-27T15:00:00.000Z",
    latestOutcome: "no_answer",
  }),
  mkLead("l05", {
    status: "callback", hasOpenCallback: true, latestOutcome: "callback_scheduled",
    attemptCount: 1, lastAttemptAt: "2026-08-20T10:00:00.000Z",
    lastContactedAt: "2026-08-20T10:00:00.000Z",
  }),
  mkLead("l06", {
    status: "appointment", hasScheduledAppointment: true, latestOutcome: "appointment_booked",
    attemptCount: 3, lastAttemptAt: "2026-08-25T10:00:00.000Z",
    lastContactedAt: "2026-08-25T10:00:00.000Z",
  }),
  mkLead("l07", {
    status: "dnc", latestOutcome: "do_not_call", attemptCount: 1,
    lastAttemptAt: "2026-08-10T10:00:00.000Z", lastContactedAt: "2026-08-10T10:00:00.000Z",
  }),
  mkLead("l08", { phoneDigits: "555010" }),
  mkLead("l09", { phoneDigits: "5595550999" }),
  mkLead("l10", { assignedRepId: null, ownerId: null }),
  mkLead("l11", { archivedAt: "2026-08-15T00:00:00.000Z" }),
  mkLead("l12", { utilityBill: null, solarPayment: 210 }),
  mkLead("l13", { utilityBill: 300, hasPool: true, hasBattery: true }),
  mkLead("l14", {
    createdAt: "2026-05-01T00:00:00.000Z", status: "no_answer", attemptCount: 5,
    lastAttemptAt: "2026-06-01T10:00:00.000Z", lastContactedAt: "2026-06-01T10:00:00.000Z",
    latestOutcome: "no_answer",
  }),
  mkLead("l15", {
    customFields: { policy_expiry: "2026-09-15", premium: 180, active: true, plan: "Gold plan" },
  }),
  mkLead("l16", { customFields: { premium: "abc", active: "no" } }),
  mkLead("l17", { customFields: { premium: "240.5" } }),
  mkLead("l18", { firstName: "Maria", lastName: "Gonzalez", city: "Clovis", zip: "93611" }),
  mkLead("l19", { phoneDigits: "8323334444" }),
  mkLead("l20", {
    status: "callback", nextEligibleAt: "2026-09-05T00:00:00.000Z",
    attemptCount: 1, lastAttemptAt: "2026-08-22T10:00:00.000Z",
  }),
  mkLead("l21", {
    status: "no_answer", nextEligibleAt: "2026-08-20T00:00:00.000Z",
    attemptCount: 2, lastAttemptAt: "2026-08-18T10:00:00.000Z",
  }),
  mkLead("l22", { importJobId: "job-7", sourceFile: "brokerA.csv" }),
  mkLead("l23", { importJobId: "job-8", sourceFile: "brokerB.csv", dialingPreference: "evening" }),
  mkLead("l24", { leadPackId: "pack-3", ownerId: "owner-2" }),
  mkLead("l25", {
    status: "qualified", latestOutcome: "qualified", utilityBill: 175, attemptCount: 1,
    lastAttemptAt: "2026-08-26T10:00:00.000Z", lastContactedAt: "2026-08-26T10:00:00.000Z",
  }),
  mkLead("l26", {
    status: "not_interested", latestOutcome: "not_interested", attemptCount: 4,
    lastAttemptAt: "2026-08-24T10:00:00.000Z", lastContactedAt: "2026-08-24T10:00:00.000Z",
  }),
  mkLead("l27", {
    status: "bills_fine", latestOutcome: "bills_fine", attemptCount: 2,
    lastAttemptAt: "2026-08-23T10:00:00.000Z", lastContactedAt: "2026-08-23T10:00:00.000Z",
  }),
  mkLead("l28", { city: "", state: "", county: null }),
  mkLead("l29", {
    city: "Houston", state: "TX", zip: "77008", county: "Harris",
    multipleSystems: true, hasEV: true, utilityBill: 260,
  }),
  mkLead("l30", { createdAt: "2026-08-27T09:00:00.000Z", campaignId: "camp-2" }),
];

export interface ParityCase {
  name: string;
  spec: FilterSpec;
  expected: string[];
}

export const PARITY_CASES: ParityCase[] = [
  {
    name: "P01 texas cities: eq OR starts_with",
    spec: spec("and", grp("or", core("city", "eq", "Houston"), core("city", "starts_with", "dal"))),
    expected: ["l02", "l03", "l29"],
  },
  {
    name: "P02 bill between 200-280 AND has EV",
    spec: spec("and", grp("and",
      core("utility_bill", "between", [200, 280]),
      core("has_ev", "is_true"),
    )),
    expected: ["l29"],
  },
  {
    name: "P03 never dialed",
    spec: spec("and", grp("and", core("never_dialed", "is_true"))),
    expected: [
      "l01", "l02", "l03", "l08", "l09", "l10", "l11", "l12", "l13", "l15",
      "l16", "l17", "l18", "l19", "l22", "l23", "l24", "l28", "l29", "l30",
    ],
  },
  {
    name: "P04 dnc by status or digit set",
    spec: spec("and", grp("and", core("dnc", "is_true"))),
    expected: ["l07", "l09"],
  },
  {
    name: "P05 invalid phone",
    spec: spec("and", grp("and", core("phone_valid", "is_false"))),
    expected: ["l08"],
  },
  {
    name: "P06 unassigned OR archived (spec-level or)",
    spec: spec("or",
      grp("and", core("unassigned", "is_true")),
      grp("and", core("archived", "is_true")),
    ),
    expected: ["l10", "l11"],
  },
  {
    name: "P07 contacted within 7 days",
    spec: spec("and", grp("and", core("last_contacted_at", "within_days", 7))),
    expected: ["l04", "l06", "l25", "l26", "l27"],
  },
  {
    name: "P08 created 30+ days ago AND before mid-June",
    spec: spec("and", grp("and",
      core("created_at", "older_than_days", 30),
      core("created_at", "before", "2026-06-15T00:00:00.000Z"),
    )),
    expected: ["l14"],
  },
  {
    name: "P09 custom premium > 200 (cast guard drops 'abc')",
    spec: spec("and", grp("and", custom("premium", "currency", "gt", 200))),
    expected: ["l17"],
  },
  {
    name: "P10 search 'maria'",
    spec: spec("and", grp("and", core("search", "contains", "maria"))),
    expected: ["l18"],
  },
  {
    name: "P11 outcome in booked/qualified",
    spec: spec("and", grp("and",
      core("latest_outcome", "in", ["appointment_booked", "qualified"]),
    )),
    expected: ["l06", "l25"],
  },
  {
    name: "P12 dial-eligible in Fresno",
    spec: spec("and", grp("and",
      core("dial_eligible", "is_true"),
      core("city", "eq", "Fresno"),
    )),
    expected: [
      "l01", "l05", "l10", "l12", "l13", "l14", "l15", "l16", "l17", "l19",
      "l21", "l22", "l23", "l24", "l30",
    ],
  },
];

describe("TS↔SQL parity fixture", () => {
  const ctx = { now: PARITY_NOW, dncDigits: PARITY_DNC_DIGITS };

  for (const pc of PARITY_CASES) {
    it(pc.name, () => {
      const got = PARITY_LEADS.filter((l) => evaluateFilter(l, pc.spec, ctx)).map((l) => l.id);
      expect([...got].sort()).toEqual([...pc.expected].sort());
    });
  }

  it("every parity spec survives sanitization unchanged", () => {
    // The SQL compiler only ever sees sanitized specs, so the contract is
    // meaningful only if these specs ARE their own sanitized form.
    for (const pc of PARITY_CASES) {
      expect(sanitizeFilterSpec(pc.spec)).toEqual(pc.spec);
    }
  });

  it("fixture ids are unique (the contract keys on them)", () => {
    const ids = PARITY_LEADS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(30);
  });
});
