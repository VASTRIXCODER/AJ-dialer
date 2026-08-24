import { describe, expect, it } from "vitest";
import { truePeopleSearchUrl } from "@/lib/leads/people-search-url";

const parse = (u: string | null) => {
  if (!u) return null;
  const url = new URL(u);
  return {
    path: `${url.origin}${url.pathname}`,
    params: Object.fromEntries(url.searchParams.entries()),
  };
};

describe("truePeopleSearchUrl", () => {
  it("builds an address search when a street address is present", () => {
    const got = parse(
      truePeopleSearchUrl({
        firstName: "Jane",
        lastName: "Doe",
        address: "1200 Maple St",
        city: "Fresno",
        state: "CA",
        zip: "93710",
      }),
    );
    expect(got?.path).toBe("https://www.truepeoplesearch.com/results");
    expect(got?.params).toEqual({
      streetaddress: "1200 Maple St",
      citystatezip: "Fresno, CA 93710",
    });
  });

  it("falls back to a name search when there's no street address", () => {
    const got = parse(
      truePeopleSearchUrl({ firstName: "Jane", lastName: "Doe", city: "Fresno", state: "CA" }),
    );
    expect(got?.params).toEqual({ name: "Jane Doe", citystatezip: "Fresno, CA" });
    expect(got?.params.streetaddress).toBeUndefined();
  });

  it("searches a bare name with no locality (the site handles it)", () => {
    const got = parse(truePeopleSearchUrl({ firstName: "Jane", lastName: "Doe" }));
    expect(got?.params).toEqual({ name: "Jane Doe" });
  });

  it("uses a name search when there's a street but no city/state/zip to anchor it", () => {
    // An address with no locality can't be an address search; fall to the name.
    const got = parse(
      truePeopleSearchUrl({ firstName: "Jane", lastName: "Doe", address: "1200 Maple St" }),
    );
    expect(got?.params).toEqual({ name: "Jane Doe" });
  });

  it("encodes spaces and punctuation as valid query params", () => {
    const raw = truePeopleSearchUrl({
      firstName: "José",
      lastName: "O'Brien",
      address: "12 Elm St #4",
      city: "St. Paul",
      state: "MN",
    });
    // No raw spaces in the query string, and it round-trips through URL parsing.
    expect(raw).not.toMatch(/\?.*[^%]\s/);
    const got = parse(raw);
    expect(got?.params.streetaddress).toBe("12 Elm St #4");
    expect(got?.params.citystatezip).toBe("St. Paul, MN");
  });

  it("returns null when there's nothing usable to search on", () => {
    expect(truePeopleSearchUrl({})).toBeNull();
    expect(truePeopleSearchUrl({ city: "Fresno", state: "CA" })).toBeNull();
    expect(truePeopleSearchUrl({ address: "1200 Maple St" })).toBeNull(); // no name, no locality
    expect(truePeopleSearchUrl({ firstName: "   ", zip: "  " })).toBeNull();
  });
});
