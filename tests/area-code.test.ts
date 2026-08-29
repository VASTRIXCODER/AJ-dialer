import { describe, expect, it } from "vitest";
import {
  AREA_CODE_LOCATIONS,
  inferNumberLocation,
} from "@/lib/leads/area-code";
import { timezoneForAreaCode } from "@/lib/dialer/lead-timezone";

describe("inferNumberLocation", () => {
  it("maps well-known area codes to the right state and timezone", () => {
    expect(inferNumberLocation("4155551234")).toEqual({
      state: "CA",
      region: "San Francisco Bay Area",
      tz: "America/Los_Angeles",
    });
    expect(inferNumberLocation("2125551234")).toMatchObject({
      state: "NY",
      tz: "America/New_York",
    });
    expect(inferNumberLocation("4805551234")).toMatchObject({
      state: "AZ",
      tz: "America/Phoenix", // AZ skips DST — must not be America/Denver
    });
    expect(inferNumberLocation("3055551234")).toMatchObject({
      state: "FL",
      tz: "America/New_York",
    });
    expect(inferNumberLocation("7375551234")).toMatchObject({
      state: "TX",
      tz: "America/Chicago",
    });
    expect(inferNumberLocation("3125551234")).toMatchObject({
      state: "IL",
      tz: "America/Chicago",
    });
    expect(inferNumberLocation("7025551234")).toMatchObject({
      state: "NV",
      tz: "America/Los_Angeles",
    });
    expect(inferNumberLocation("2065551234")).toMatchObject({
      state: "WA",
      tz: "America/Los_Angeles",
    });
    expect(inferNumberLocation("3035551234")).toMatchObject({
      state: "CO",
      tz: "America/Denver",
    });
    expect(inferNumberLocation("4045551234")).toMatchObject({
      state: "GA",
      tz: "America/New_York",
    });
    expect(inferNumberLocation("6155551234")).toMatchObject({
      state: "TN",
      tz: "America/Chicago",
    });
    expect(inferNumberLocation("8085551234")).toMatchObject({
      state: "HI",
      tz: "Pacific/Honolulu",
    });
  });

  it("respects intra-state timezone splits (the tz table is the authority)", () => {
    // El Paso is TX but Mountain time; the Panhandle of FL is Central.
    expect(inferNumberLocation("9155551234")).toMatchObject({
      state: "TX",
      tz: "America/Denver",
    });
    expect(inferNumberLocation("8505551234")).toMatchObject({
      state: "FL",
      tz: "America/Chicago",
    });
  });

  it("strips formatting and a leading 1", () => {
    const bare = inferNumberLocation("4155551234");
    expect(inferNumberLocation("+14155551234")).toEqual(bare);
    expect(inferNumberLocation("1 (415) 555-1234")).toEqual(bare);
    expect(inferNumberLocation("415-555-1234")).toEqual(bare);
    expect(inferNumberLocation("(415) 555.1234")).toEqual(bare);
  });

  it("returns null for invalid, short, or non-NANP input", () => {
    expect(inferNumberLocation("")).toBeNull();
    expect(inferNumberLocation("garbage")).toBeNull();
    expect(inferNumberLocation("12345")).toBeNull(); // too short
    expect(inferNumberLocation("415555")).toBeNull(); // still too short
    expect(inferNumberLocation("+442071234567")).toBeNull(); // UK number
    expect(inferNumberLocation("5551234567")).toBeNull(); // 555 is not geographic
    expect(inferNumberLocation("9995551234")).toBeNull(); // unassigned code
    expect(inferNumberLocation("0125551234")).toBeNull(); // NANP codes can't start with 0
  });

  it("never claims city-level precision: region is a coarse label", () => {
    // 310 spans dozens of cities — the region must stay at metro altitude.
    expect(inferNumberLocation("3105551234")?.region).toBe("Los Angeles area");
    // No region anywhere sneaks in an address, zip, or street-level detail.
    for (const { region } of Object.values(AREA_CODE_LOCATIONS)) {
      expect(region).not.toMatch(/\d/);
    }
  });
});

describe("AREA_CODE_LOCATIONS invariants", () => {
  it("covers a broad national spread", () => {
    expect(Object.keys(AREA_CODE_LOCATIONS).length).toBeGreaterThanOrEqual(300);
    const states = new Set(Object.values(AREA_CODE_LOCATIONS).map((l) => l.state));
    for (const s of ["CA", "TX", "FL", "NY", "AZ", "NV", "CO", "WA", "OR", "UT", "IL", "GA", "NC", "PA", "OH", "MI", "NJ", "MA"]) {
      expect(states.has(s)).toBe(true);
    }
    expect(states.size).toBeGreaterThanOrEqual(45);
  });

  it("every mapped code resolves in the dialer's tz table to a valid IANA zone", () => {
    for (const code of Object.keys(AREA_CODE_LOCATIONS)) {
      const tz = timezoneForAreaCode(code);
      expect(tz, `area code ${code} missing from lead-timezone`).toBeTruthy();
      // A bogus zone would throw here — proves the strings are real IANA ids.
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: tz! })).not.toThrow();
    }
  });

  it("agrees with the tz the dialer would use (spot check)", () => {
    for (const code of ["415", "212", "737", "915", "480", "305", "907"]) {
      expect(inferNumberLocation(`${code}5551234`)).toMatchObject({
        tz: timezoneForAreaCode(code),
      });
    }
  });

  it("well-formed entries: two-letter state, non-empty region", () => {
    for (const [code, loc] of Object.entries(AREA_CODE_LOCATIONS)) {
      expect(code).toMatch(/^[2-9]\d\d$/);
      expect(loc.state).toMatch(/^[A-Z]{2}$/);
      expect(loc.region.length).toBeGreaterThan(2);
    }
  });
});
