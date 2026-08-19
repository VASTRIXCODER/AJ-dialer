import { describe, expect, it } from "vitest";
import { countyForZip, ZIP_COUNTY_COVERAGE } from "@/lib/leads/zip-county";

describe("countyForZip", () => {
  it("resolves real ZIPs to their county and state", () => {
    expect(countyForZip("90210")).toEqual({ county: "Los Angeles", state: "CA" });
    expect(countyForZip("10001")).toEqual({ county: "New York", state: "NY" });
    expect(countyForZip("60601")).toEqual({ county: "Cook", state: "IL" });
    expect(countyForZip("93710")).toEqual({ county: "Fresno", state: "CA" });
  });

  it("tolerates ZIP+4 and stray whitespace, using only the first 5 digits", () => {
    expect(countyForZip("90210-1234")).toEqual({ county: "Los Angeles", state: "CA" });
    expect(countyForZip("  90210  ")).toEqual({ county: "Los Angeles", state: "CA" });
  });

  it("returns null rather than guessing for unknown or malformed input", () => {
    expect(countyForZip("99999")).toBeNull(); // not a real ZCTA
    expect(countyForZip("1234")).toBeNull(); // too short
    expect(countyForZip("")).toBeNull();
    expect(countyForZip(null)).toBeNull();
    expect(countyForZip(undefined)).toBeNull();
  });

  it("exposes a non-trivial coverage count for the backfill/admin UI", () => {
    // Loose bound, not an exact figure — just guards against the data file
    // silently shrinking to near-empty (e.g. a bad rebuild) without pinning
    // it to the precise row count, which would break on every data refresh.
    expect(ZIP_COUNTY_COVERAGE).toBeGreaterThan(25_000);
  });
});
