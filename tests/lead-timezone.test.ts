import { describe, expect, it } from "vitest";
import { resolveLeadTimezone, timezoneForAreaCode } from "@/lib/dialer/lead-timezone";

describe("timezoneForAreaCode", () => {
  it("maps the app's target states correctly", () => {
    expect(timezoneForAreaCode("415")).toBe("America/Los_Angeles"); // CA
    expect(timezoneForAreaCode("214")).toBe("America/Chicago"); // TX (Dallas)
    expect(timezoneForAreaCode("713")).toBe("America/Chicago"); // TX (Houston)
    expect(timezoneForAreaCode("915")).toBe("America/Denver"); // TX El Paso (Mountain)
    expect(timezoneForAreaCode("212")).toBe("America/New_York"); // NY
    expect(timezoneForAreaCode("808")).toBe("Pacific/Honolulu"); // HI
  });

  it("returns null for unknown / non-NANP codes", () => {
    expect(timezoneForAreaCode("999")).toBeNull();
    expect(timezoneForAreaCode(null)).toBeNull();
  });
});

describe("resolveLeadTimezone", () => {
  it("prefers a stored IANA zone", () => {
    expect(resolveLeadTimezone("+14155551234", "America/Denver", "America/Chicago")).toBe(
      "America/Denver",
    );
  });

  it("falls back to the number's area code", () => {
    expect(resolveLeadTimezone("+14155551234", "", "America/Chicago")).toBe(
      "America/Los_Angeles",
    );
    expect(resolveLeadTimezone("+12145550000", null, "America/Chicago")).toBe(
      "America/Chicago",
    );
  });

  it("falls back to the org default for an unknown area code", () => {
    expect(resolveLeadTimezone("+19995550000", "", "America/Chicago")).toBe(
      "America/Chicago",
    );
    expect(resolveLeadTimezone("garbage", "", "America/New_York")).toBe("America/New_York");
  });

  it("does not treat a non-IANA stored value as a zone", () => {
    // "PST" has no slash → not trusted; falls through to area code (CA → Pacific).
    expect(resolveLeadTimezone("+14155551234", "PST", "America/Chicago")).toBe(
      "America/Los_Angeles",
    );
  });
});
