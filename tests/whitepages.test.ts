import { describe, expect, it } from "vitest";
import { looksBlocked, whitepagesUrl } from "@/lib/leads/whitepages";

const page = (over: Partial<Parameters<typeof looksBlocked>[0]> = {}) => ({
  status: 200,
  finalUrl: "https://www.whitepages.com/name/Jane-Doe/Fresno-CA",
  title: "Jane Doe in Fresno, CA",
  text: "Jane Doe\n(559) 555-0143\nLandline",
  ...over,
});

describe("whitepagesUrl", () => {
  it("prefers an address search when a street address is known", () => {
    // An address resolves to one household; a name search on a common name
    // returns a page of different people.
    expect(
      whitepagesUrl({
        firstName: "Jane",
        lastName: "Doe",
        address: "1200 Maple St",
        city: "Fresno",
        state: "CA",
      }),
    ).toBe("https://www.whitepages.com/address/1200-Maple-St/Fresno-CA");
  });

  it("falls back to a name search when there is no street address", () => {
    expect(
      whitepagesUrl({ firstName: "Jane", lastName: "Doe", city: "Fresno", state: "CA" }),
    ).toBe("https://www.whitepages.com/name/Jane-Doe/Fresno-CA");
  });

  it("slugifies punctuation, accents and runs of spaces", () => {
    expect(
      whitepagesUrl({
        firstName: "José",
        lastName: "O'Brien-Smith",
        city: "St. Paul",
        state: "MN",
      }),
    ).toBe("https://www.whitepages.com/name/Jose-O-Brien-Smith/St-Paul-MN");
  });

  it("handles a name with no locality at all", () => {
    expect(whitepagesUrl({ firstName: "Jane", lastName: "Doe" })).toBe(
      "https://www.whitepages.com/name/Jane-Doe",
    );
  });

  it("returns null when there is nothing to search on", () => {
    expect(whitepagesUrl({})).toBeNull();
    expect(whitepagesUrl({ city: "Fresno", state: "CA" })).toBeNull();
    expect(whitepagesUrl({ firstName: "   ", address: "  " })).toBeNull();
  });

  it("never emits a url with leading, trailing or doubled hyphens", () => {
    const url = whitepagesUrl({
      firstName: "  Jane  ",
      lastName: "  Doe!!  ",
      city: " Fresno ",
      state: " CA ",
    });
    expect(url).toBe("https://www.whitepages.com/name/Jane-Doe/Fresno-CA");
    expect(url).not.toMatch(/--|\/-|-\//);
  });
});

describe("looksBlocked", () => {
  it("treats bot-check status codes as blocked", () => {
    for (const status of [403, 429, 503]) {
      expect(looksBlocked(page({ status }))).toBe(true);
    }
  });

  it("recognizes challenge pages by their text", () => {
    for (const text of [
      "Press & Hold to confirm you are a human",
      "Please verify you are a human",
      "We've detected unusual traffic from your network",
      "Access Denied",
      "Checking your browser before accessing",
      "Please enable JavaScript and cookies to continue",
    ]) {
      expect(looksBlocked(page({ text }))).toBe(true);
    }
  });

  it("matches case-insensitively and looks at the title too", () => {
    expect(looksBlocked(page({ title: "ACCESS DENIED", text: "" }))).toBe(true);
    expect(looksBlocked(page({ text: "CAPTCHA required" }))).toBe(true);
  });

  it("does NOT flag an ordinary results page", () => {
    expect(looksBlocked(page())).toBe(false);
  });

  it("does not flag a genuine no-results page as blocked", () => {
    // This distinction is the whole point: a real empty result must stay
    // "no results" so it never gets reported as a block, or vice versa.
    expect(
      looksBlocked(page({ text: "We couldn't find anyone matching that search." })),
    ).toBe(false);
  });
});
