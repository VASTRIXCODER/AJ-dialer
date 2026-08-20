import { describe, expect, it } from "vitest";
import { cityKey, normalizeCityKey } from "@/lib/db/leads";
import type { Lead } from "@/lib/types";

const lead = (city: string, state: string) => ({ city, state }) as Lead;

/**
 * These assertions are the JS half of a contract whose other half lives in
 * app_leads_page's p_city predicate (supabase/schema.sql). The SQL side was
 * verified against a real Postgres with the same cases; if either side changes,
 * these should fail rather than the two silently drifting — which is exactly
 * how the "trim the whole composite" bug got in.
 */
describe("city key folding (JS twin of app_leads_page's p_city)", () => {
  it("folds case", () => {
    expect(cityKey(lead("Fresno", "CA"))).toBe("fresno|ca");
    expect(cityKey(lead("FRESNO", "CA"))).toBe("fresno|ca");
    expect(cityKey(lead("fresno", "ca"))).toBe("fresno|ca");
  });

  it("trims each side independently, not just the whole composite", () => {
    // The case that failed against live Postgres before the fix.
    expect(normalizeCityKey(" Zeta | CA ")).toBe("zeta|ca");
    expect(cityKey(lead("Fresno ", "CA"))).toBe("fresno|ca");
    expect(cityKey(lead(" Fresno", " CA "))).toBe("fresno|ca");
  });

  it("keeps same-named cities in different states apart", () => {
    expect(cityKey(lead("Springfield", "IL"))).not.toBe(cityKey(lead("Springfield", "MO")));
  });

  it("returns an empty key for a lead with no city", () => {
    expect(cityKey(lead("", "CA"))).toBe("");
    expect(cityKey(lead("   ", "CA"))).toBe("");
  });

  it("matches a filter value against a lead the same way the SQL does", () => {
    // The three spellings the live-Postgres run collapsed into one bucket.
    for (const spelling of ["Zeta", "zeta ", "ZETA"]) {
      expect(cityKey(lead(spelling, "CA"))).toBe(normalizeCityKey("Zeta|CA"));
    }
  });
});
