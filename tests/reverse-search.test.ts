import { describe, expect, it } from "vitest";
import { harvestPhones, hasSearchableIdentity } from "@/lib/leads/reverse-search";

const phones = (payload: unknown) => harvestPhones(payload).map((c) => c.phone);

describe("harvestPhones — vendor payload shapes", () => {
  it("reads an Ekata-shaped reverse_address response", () => {
    const payload = {
      current_residents: [
        {
          name: "Jane Doe",
          phones: [
            { phone_number: "559-555-0143", line_type: "Mobile" },
            { phone_number: "(559) 555-0177", line_type: "Landline" },
          ],
        },
      ],
    };
    const got = harvestPhones(payload);
    expect(got.map((c) => c.phone)).toEqual(["+15595550143", "+15595550177"]);
    expect(got[0].lineType).toBe("mobile");
    expect(got[1].lineType).toBe("landline");
    expect(got[0].matchedName).toBe("Jane Doe");
  });

  it("reads an Endato-shaped contact-enrich response", () => {
    const payload = {
      person: {
        name: { firstName: "Bob", lastName: "Smith" },
        phones: [{ number: "+1 213 555 0110", type: "Wireless", confidence: 0.92 }],
      },
    };
    const got = harvestPhones(payload);
    expect(got[0].phone).toBe("+12135550110");
    expect(got[0].lineType).toBe("mobile");
    expect(got[0].confidence).toBe(92); // 0-1 scaled to 0-100
    expect(got[0].matchedName).toBe("Bob Smith");
  });

  it("reads a BatchData-shaped skip-trace response", () => {
    const payload = {
      results: {
        persons: [
          {
            name: { first: "Ana", last: "Ruiz" },
            phoneNumbers: [
              { number: "8325550101", type: "Landline", score: 74 },
              { number: "8325550102", type: "Mobile", score: 88 },
            ],
          },
        ],
      },
    };
    const got = harvestPhones(payload);
    expect(got.map((c) => c.phone).sort()).toEqual(["+18325550101", "+18325550102"]);
    expect(got.find((c) => c.phone === "+18325550102")?.confidence).toBe(88);
  });

  it("handles a bare array of strings under a phone-ish key", () => {
    expect(phones({ phones: ["5595550143", "5595550177"] })).toEqual([
      "+15595550143",
      "+15595550177",
    ]);
  });

  it("dedupes the same number reached by different paths", () => {
    const payload = {
      person: { phones: [{ number: "5595550143" }] },
      household: { contact_phone: "(559) 555-0143" },
    };
    expect(phones(payload)).toEqual(["+15595550143"]);
  });
});

describe("harvestPhones — not mistaking identifiers for phones", () => {
  it("ignores a bare 10-digit id that isn't under a phone-ish key", () => {
    // An account number is exactly 10 digits and normalizes fine — only the
    // absence of a phone-ish key and of punctuation keeps it out.
    expect(phones({ accountNumber: "1234567890", recordId: "9876543210" })).toEqual([]);
  });

  it("ignores zips, which are too short to normalize anyway", () => {
    expect(phones({ zip: "93710", postal_code: "90210" })).toEqual([]);
  });

  it("still finds a punctuated number when nothing sits under a phone key", () => {
    // Fallback sweep: looks like a phone, so it's worth surfacing.
    expect(phones({ notes: "best reach: (559) 555-0143" })).toEqual(["+15595550143"]);
  });

  it("prefers the keyed pass and does not run the loose sweep when it succeeds", () => {
    const payload = {
      phone: "5595550143",
      // Would be swept up by pass 2, but pass 1 found something so pass 2 never runs.
      memo: "ref 213-555-0199",
    };
    expect(phones(payload)).toEqual(["+15595550143"]);
  });

  it("returns nothing for empty / malformed payloads instead of throwing", () => {
    expect(phones(null)).toEqual([]);
    expect(phones(undefined)).toEqual([]);
    expect(phones({})).toEqual([]);
    expect(phones([])).toEqual([]);
    expect(phones({ phone: "not a number" })).toEqual([]);
    expect(phones({ phone: null })).toEqual([]);
  });
});

describe("harvestPhones — metadata normalization", () => {
  it("maps vendor line-type vocabularies onto our four types", () => {
    const t = (type: string) => harvestPhones({ phones: [{ number: "5595550143", type }] })[0].lineType;
    expect(t("Wireless")).toBe("mobile");
    expect(t("CELL")).toBe("mobile");
    expect(t("NonFixedVOIP")).toBe("voip");
    expect(t("Residential")).toBe("landline");
    expect(t("FixedLine")).toBe("landline");
    expect(t("something new")).toBe("unknown");
  });

  it("accepts both 0-1 and 0-100 confidence scales, and rejects out-of-range", () => {
    const c = (confidence: unknown) =>
      harvestPhones({ phones: [{ number: "5595550143", confidence }] })[0].confidence;
    expect(c(0.85)).toBe(85);
    expect(c(85)).toBe(85);
    expect(c(-5)).toBeNull();
    expect(c(150)).toBeNull();
    expect(c("not a score")).toBeNull();
  });

  it("reports no confidence rather than inventing one when the vendor omits it", () => {
    expect(harvestPhones({ phones: [{ number: "5595550143" }] })[0].confidence).toBeNull();
  });
});

describe("hasSearchableIdentity", () => {
  it("accepts an address with a city or zip", () => {
    expect(hasSearchableIdentity({ address: "1 Main St", city: "Fresno" })).toBe(true);
    expect(hasSearchableIdentity({ address: "1 Main St", zip: "93710" })).toBe(true);
  });

  it("accepts a name that is located to a city, state or zip", () => {
    expect(hasSearchableIdentity({ firstName: "Jane", lastName: "Doe", state: "CA" })).toBe(true);
  });

  it("rejects a name with nowhere to look, which would match half a state", () => {
    expect(hasSearchableIdentity({ firstName: "Jane", lastName: "Doe" })).toBe(false);
  });

  it("rejects a street address with no city or zip to disambiguate it", () => {
    expect(hasSearchableIdentity({ address: "1 Main St" })).toBe(false);
  });

  it("rejects an empty lead", () => {
    expect(hasSearchableIdentity({})).toBe(false);
    expect(hasSearchableIdentity({ firstName: "  ", address: "  " })).toBe(false);
  });
});
