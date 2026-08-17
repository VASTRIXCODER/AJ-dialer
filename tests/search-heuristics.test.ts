import { describe, expect, it } from "vitest";
import {
  hasStructuredPredicates,
  leadMatchesParsedQuery,
  parseLeadQuery,
} from "@/lib/leads/search-heuristics";
import type { Lead } from "@/lib/types";

describe("parseLeadQuery — bill thresholds", () => {
  it("reads a directed floor ('over 200')", () => {
    const p = parseLeadQuery("bills over 200");
    expect(p.minBill).toBe(200);
    expect(p.maxBill).toBeNull();
  });

  it("reads a directed ceiling ('under 150')", () => {
    const p = parseLeadQuery("paying under $150 a month");
    expect(p.maxBill).toBe(150);
    expect(p.minBill).toBeNull();
  });

  it("treats a bare '$300' as a floor, like simulateSearch's threshold", () => {
    expect(parseLeadQuery("homeowners paying $300").minBill).toBe(300);
  });

  it("maps 'high bill' language to the high_bill smart list's $200 floor", () => {
    expect(parseLeadQuery("high bill leads").minBill).toBe(200);
    expect(parseLeadQuery("homeowners overpaying").minBill).toBe(200);
  });

  it("lets an explicit number beat the 'high bill' default", () => {
    expect(parseLeadQuery("high bills over 350").minBill).toBe(350);
  });

  it("reads both bounds when both directions appear", () => {
    const p = parseLeadQuery("between over 200 and under 400");
    expect(p.minBill).toBe(200);
    expect(p.maxBill).toBe(400);
  });
});

describe("parseLeadQuery — home-load keywords", () => {
  it("detects EV via 'ev', 'electric vehicle', and 'tesla'", () => {
    expect(parseLeadQuery("homeowners with an ev").wantsEV).toBe(true);
    expect(parseLeadQuery("electric vehicle owners").wantsEV).toBe(true);
    expect(parseLeadQuery("drives a tesla").wantsEV).toBe(true);
  });

  it("does NOT read the 'ev' inside 'never' as an EV query", () => {
    expect(parseLeadQuery("never called").wantsEV).toBe(false);
  });

  it("detects pools and batteries (incl. 'storage' / 'powerwall')", () => {
    expect(parseLeadQuery("has a pool").wantsPool).toBe(true);
    expect(parseLeadQuery("battery owners").wantsBattery).toBe(true);
    expect(parseLeadQuery("home storage systems").wantsBattery).toBe(true);
    expect(parseLeadQuery("powerwall installed").wantsBattery).toBe(true);
  });
});

describe("parseLeadQuery — status words", () => {
  it("maps status keywords to lead statuses", () => {
    expect(parseLeadQuery("new leads").statuses).toEqual(["new"]);
    expect(parseLeadQuery("my callbacks").statuses).toEqual(["callback"]);
    expect(parseLeadQuery("qualified homeowners").statuses).toEqual(["qualified"]);
    expect(parseLeadQuery("warm leads").statuses).toEqual(["qualified"]);
    expect(parseLeadQuery("booked appointments").statuses).toEqual(["appointment"]);
    expect(parseLeadQuery("didn't answer").statuses).toEqual(["no_answer"]);
    expect(parseLeadQuery("no answer yet").statuses).toEqual(["no_answer"]);
  });

  it("flags never-called phrasing", () => {
    expect(parseLeadQuery("never called").neverCalled).toBe(true);
    expect(parseLeadQuery("uncontacted homeowners").neverCalled).toBe(true);
    expect(parseLeadQuery("fresh leads").neverCalled).toBe(true);
    expect(parseLeadQuery("called last week").neverCalled).toBe(false);
  });
});

describe("parseLeadQuery — tokens & stopwords", () => {
  it("keeps meaningful words and drops scaffolding", () => {
    expect(parseLeadQuery("show me all the homeowners in fresno").tokens).toEqual([
      "fresno",
    ]);
  });

  it("drops words under 3 chars and pure numbers", () => {
    expect(parseLeadQuery("pg e 300 tx").tokens).toEqual([]);
  });

  it("drops words a structured predicate already consumed", () => {
    const p = parseLeadQuery("qualified homeowners with a pool in houston");
    expect(p.tokens).toEqual(["houston"]);
    expect(p.statuses).toEqual(["qualified"]);
    expect(p.wantsPool).toBe(true);
  });

  it("dedupes repeated tokens", () => {
    expect(parseLeadQuery("edison edison edison").tokens).toEqual(["edison"]);
  });

  it("a purely structured query yields no lexical tokens", () => {
    const p = parseLeadQuery("homeowners overpaying with an EV");
    expect(p.tokens).toEqual([]);
    expect(p.wantsEV).toBe(true);
    expect(p.minBill).toBe(200);
    expect(hasStructuredPredicates(p)).toBe(true);
  });
});

describe("leadMatchesParsedQuery — union semantics", () => {
  const lead = (over: Partial<Lead>): Lead => ({
    id: "l1",
    firstName: "Dana",
    lastName: "Kim",
    phone: "+15551234567",
    address: "1 Main St",
    city: "Fresno",
    state: "CA",
    zip: "93711",
    utilityProvider: "PG&E",
    solarProvider: "Sunrun",
    status: "new",
    campaignId: "",
    hasEV: false,
    hasPool: false,
    hasBattery: false,
    multipleSystems: false,
    timezone: "America/Los_Angeles",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("a structured hit matches without any lexical surface", () => {
    const p = parseLeadQuery("homeowners overpaying with an EV");
    expect(leadMatchesParsedQuery(lead({ hasEV: true, utilityBill: 320 }), p)).toBe(true);
    expect(leadMatchesParsedQuery(lead({ hasEV: false, utilityBill: 320 }), p)).toBe(false);
  });

  it("a lexical hit is ORed with failing structured predicates, never AND-required", () => {
    const p = parseLeadQuery("ev owners in fresno");
    // No EV, but the city token still surfaces them as a candidate.
    expect(leadMatchesParsedQuery(lead({ hasEV: false }), p)).toBe(true);
  });

  it("bill bounds require a known bill, matching SQL null semantics", () => {
    const p = parseLeadQuery("bills under 150");
    expect(leadMatchesParsedQuery(lead({ utilityBill: undefined }), p)).toBe(false);
    expect(leadMatchesParsedQuery(lead({ utilityBill: 120 }), p)).toBe(true);
  });

  it("an unparseable query matches everything (caller caps at the limit)", () => {
    expect(leadMatchesParsedQuery(lead({}), parseLeadQuery("the of and"))).toBe(true);
  });
});
