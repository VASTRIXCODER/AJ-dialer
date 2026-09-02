import { describe, expect, it } from "vitest";
import { areaCodeOf, localPresenceMatches } from "@/lib/dialer/rotation";

// The org's pool for these tests: two Dallas-area numbers, one NY, one LA.
const POOL = ["+12145551000", "+14695551001", "+19145551002", "+13235551003"];

describe("areaCodeOf", () => {
  it("reads the area code regardless of how the number is written", () => {
    expect(areaCodeOf("+12145551000")).toBe("214");
    expect(areaCodeOf("(214) 555-1000")).toBe("214");
    expect(areaCodeOf("2145551000")).toBe("214");
  });

  it("returns null for anything that isn't a NANP number", () => {
    expect(areaCodeOf("")).toBeNull();
    expect(areaCodeOf(null)).toBeNull();
    expect(areaCodeOf("+442071838750")).toBeNull();
    expect(areaCodeOf("12345")).toBeNull();
  });
});

describe("localPresenceMatches", () => {
  it("finds pool numbers sharing the lead's area code", () => {
    // A 214 lead is matched by the 214 number, not the 469 one — same metro,
    // but only the exact area code reads as local on a caller ID.
    expect(localPresenceMatches(POOL, "+12145559999")).toEqual(["+12145551000"]);
    expect(localPresenceMatches(POOL, "+14695559999")).toEqual(["+14695551001"]);
  });

  it("returns nothing when the pool can't cover the lead's area code", () => {
    // 512 (Austin) isn't in the pool — the dialer must fall back to normal
    // rotation rather than pretending to match.
    expect(localPresenceMatches(POOL, "+15125559999")).toEqual([]);
  });

  it("returns nothing for a lead whose number isn't NANP", () => {
    expect(localPresenceMatches(POOL, "+442071838750")).toEqual([]);
    expect(localPresenceMatches(POOL, "")).toEqual([]);
  });

  it("preserves pool order so rotation stays deterministic among matches", () => {
    const twoDallas = ["+12145551000", "+12145552000", "+19145551002"];
    expect(localPresenceMatches(twoDallas, "+12145559999")).toEqual([
      "+12145551000",
      "+12145552000",
    ]);
  });
});

describe("what the dialer's toggle actually decides", () => {
  // The picker computes this to label the pill: can the rep's ENABLED numbers
  // match the lead in front of them?
  const canMatch = (pool: string[], excluded: string[], dest: string) => {
    const enabled = pool.filter((n) => !excluded.includes(n));
    return localPresenceMatches(enabled, dest).length > 0;
  };

  it("reports a match when an enabled number shares the area code", () => {
    expect(canMatch(POOL, [], "+12145559999")).toBe(true);
  });

  it("reports NO match once the rep excludes the only local number", () => {
    // This is why the pill has to read from the enabled set, not the org pool:
    // excluding 214 means this call rotates, and the rep should see that.
    expect(canMatch(POOL, ["+12145551000"], "+12145559999")).toBe(false);
  });

  it("reports no match for a lead in an area code the org owns no number in", () => {
    expect(canMatch(POOL, [], "+15125559999")).toBe(false);
  });
});
