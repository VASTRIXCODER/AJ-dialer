import { describe, expect, it } from "vitest";
import {
  describeLeadClock,
  leadLocalTime,
  resolveLeadTimezone,
  timezoneForAreaCode,
} from "@/lib/dialer/lead-timezone";

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

// ─────────────────────────────────────────────────────────────────────────────
// The clock a rep can actually read.
//
// This resolver has driven server-side TCPA enforcement for a long time and no
// surface in the product ever rendered its answer — so a rep in Phoenix worked
// down a list of New Jersey contacts at what was, to them, a reasonable hour,
// and watched lane after lane cancel with no idea why.
// ─────────────────────────────────────────────────────────────────────────────

describe("leadLocalTime", () => {
  // 2026-08-30T02:30:00Z — 7:30pm on the 29th in California, 10:30pm in NY.
  const at = new Date("2026-08-30T02:30:00.000Z");
  const HOURS = { startHour: 8, endHour: 21, days: [0, 1, 2, 3, 4, 5, 6] };

  it("reports the time where the CONTACT is, not where the rep is", () => {
    expect(leadLocalTime("+14155551234", null, "America/New_York", at)?.time).toBe("7:30 PM");
    expect(leadLocalTime("+12125551234", null, "America/Los_Angeles", at)?.time).toBe(
      "10:30 PM",
    );
  });

  it("flags a contact who is outside the window in their OWN zone", () => {
    // Same instant, same org policy (8am–9pm): fine in California, too late in
    // New York. This is the exact case the dial route refuses and the rep
    // could not see coming.
    expect(leadLocalTime("+14155551234", null, "America/Chicago", at, HOURS)?.outsideWindow).toBe(
      false,
    );
    expect(leadLocalTime("+12125551234", null, "America/Chicago", at, HOURS)?.outsideWindow).toBe(
      true,
    );
  });

  it("says where the zone came from, because an area code is a guess", () => {
    expect(leadLocalTime("+14155551234", "America/Denver", "UTC", at)?.source).toBe("stored");
    expect(leadLocalTime("+14155551234", null, "UTC", at)?.source).toBe("areaCode");
    // 999 is not a real NANP code — nothing to infer from.
    expect(leadLocalTime("+19995551234", null, "America/Chicago", at)?.source).toBe("fallback");
  });

  it("honours an overnight window", () => {
    const overnight = { startHour: 20, endHour: 6 };
    // 10:30pm in New York is inside 8pm–6am.
    expect(
      leadLocalTime("+12125551234", null, "UTC", at, overnight)?.outsideWindow,
    ).toBe(false);
    // 7:30pm in California is not.
    expect(
      leadLocalTime("+14155551234", null, "UTC", at, overnight)?.outsideWindow,
    ).toBe(true);
  });

  it("skips the window check entirely when the workspace has no hours set", () => {
    expect(leadLocalTime("+12125551234", null, "UTC", at, null)?.outsideWindow).toBe(false);
    expect(leadLocalTime("+12125551234", null, "UTC", at)?.outsideWindow).toBe(false);
  });

  it("says nothing rather than showing the rep their own clock", () => {
    // An unusable stored zone. Falling back to the local one would put a
    // confident, wrong time on the row — worse than an empty space.
    expect(leadLocalTime("+14155551234", "Mars/Olympus_Mons", "Mars/Olympus_Mons", at)).toBeNull();
  });

  it("reads as a sentence", () => {
    const inside = leadLocalTime("+14155551234", null, "UTC", at, HOURS)!;
    const outside = leadLocalTime("+12125551234", null, "UTC", at, HOURS)!;
    expect(describeLeadClock(inside)).toBe("7:30 PM their time");
    expect(describeLeadClock(outside)).toBe("10:30 PM their time — outside calling hours");
  });
});
