import { describe, expect, it } from "vitest";
import { leadToFilterShape } from "@/lib/db/leads-filter";
import {
  evaluateFilter,
  type FilterCondition,
  type FilterContext,
  type FilterSpec,
} from "@/lib/leads/filter-spec";
import type { Lead } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// The demo/degraded filter path: an app Lead → LeadForFilter (leadToFilterShape)
// → evaluateFilter. These assertions pin the shape adapter's approximations
// (Lead carries no attempt columns; lastContactedAt stands in) so the demo
// book's tiles and filters agree with what the SQL would say about real rows.
// ─────────────────────────────────────────────────────────────────────────────

function mkLead(id: string, over: Partial<Lead> = {}): Lead {
  return {
    id,
    firstName: "Demo",
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

const CTX: FilterContext = { now: new Date("2026-08-28T12:00:00.000Z") };

const one = (cond: FilterCondition): FilterSpec => ({
  op: "and",
  groups: [{ op: "and", conditions: [cond] }],
});

const derived = (key: "never_dialed" | "dnc", cmp: "is_true" | "is_false" = "is_true"): FilterCondition => ({
  kind: "derived",
  key,
  cmp,
});

describe("leadToFilterShape", () => {
  it("strips the phone to digits", () => {
    expect(leadToFilterShape(mkLead("a")).phoneDigits).toBe("5595550100");
  });

  it("approximates the attempt columns from lastContactedAt", () => {
    const fresh = leadToFilterShape(mkLead("a"));
    expect(fresh.attemptCount).toBe(0);
    expect(fresh.lastAttemptAt).toBeNull();

    const contacted = leadToFilterShape(
      mkLead("b", { lastContactedAt: "2026-08-20T10:00:00.000Z" }),
    );
    expect(contacted.attemptCount).toBe(1);
    expect(contacted.lastAttemptAt).toBe("2026-08-20T10:00:00.000Z");
  });

  it("mirrors the SQL's dialing_preference default (COALESCE → 'either')", () => {
    expect(leadToFilterShape(mkLead("a")).dialingPreference).toBe("either");
  });

  it("stands status in for the callback/appointment joins the demo book lacks", () => {
    expect(leadToFilterShape(mkLead("a", { status: "callback" })).hasOpenCallback).toBe(true);
    expect(
      leadToFilterShape(mkLead("b", { status: "appointment" })).hasScheduledAppointment,
    ).toBe(true);
    expect(leadToFilterShape(mkLead("c")).hasOpenCallback).toBe(false);
  });
});

describe("demo evaluateFilter path", () => {
  it("never_dialed: matches only the untouched lead", () => {
    const fresh = leadToFilterShape(mkLead("a"));
    const worked = leadToFilterShape(
      mkLead("b", { lastContactedAt: "2026-08-20T10:00:00.000Z" }),
    );
    expect(evaluateFilter(fresh, one(derived("never_dialed")), CTX)).toBe(true);
    expect(evaluateFilter(worked, one(derived("never_dialed")), CTX)).toBe(false);
    expect(evaluateFilter(worked, one(derived("never_dialed", "is_false")), CTX)).toBe(true);
  });

  it("dnc: a suppressed number and a dnc status both count", () => {
    const ctxWithDnc: FilterContext = { ...CTX, dncDigits: new Set(["5595550100"]) };
    const plain = leadToFilterShape(mkLead("a"));
    expect(evaluateFilter(plain, one(derived("dnc")), ctxWithDnc)).toBe(true);
    // Same lead, no suppression list → not DNC.
    expect(evaluateFilter(plain, one(derived("dnc")), CTX)).toBe(false);
    // Status dnc counts even when the number isn't on the list.
    const statusDnc = leadToFilterShape(mkLead("b", { status: "dnc" }));
    expect(evaluateFilter(statusDnc, one(derived("dnc")), CTX)).toBe(true);
  });

  it("status eq: exact stored-key match", () => {
    const lead = leadToFilterShape(mkLead("a", { status: "qualified" }));
    expect(
      evaluateFilter(lead, one({ kind: "core", key: "status", cmp: "eq", value: "qualified" }), CTX),
    ).toBe(true);
    expect(
      evaluateFilter(lead, one({ kind: "core", key: "status", cmp: "eq", value: "new" }), CTX),
    ).toBe(false);
  });
});
