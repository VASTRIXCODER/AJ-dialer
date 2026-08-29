import { describe, expect, it } from "vitest";
import {
  floatingRelativeTime,
  floatingToUtcIso,
} from "../src/lib/appointments/time";
import { zonedFloatingNow } from "../src/lib/dialer/schedule";

// ─────────────────────────────────────────────────────────────────────────────
// The floating wall-clock convention (callbacks.due_at, appointments.
// scheduled_at) versus real UTC instants.
//
// The bug these pin: My Day and the Command Center compared a FLOATING due_at
// against `new Date().toISOString()`. In America/Chicago that reads a callback
// promised for 2pm as overdue from 9am — and the who-next card announced
// "it's due now", pushing a rep to break the promise by calling early.
// ─────────────────────────────────────────────────────────────────────────────

describe("zonedFloatingNow", () => {
  it("renders the wall clock in the org's zone, offset-less", () => {
    // 19:00Z on 2026-08-29 is 14:00 in Chicago (CDT, UTC-5).
    const at = new Date("2026-08-29T19:00:00.000Z");
    expect(zonedFloatingNow(at, "America/Chicago")).toBe("2026-08-29T14:00:00");
    expect(zonedFloatingNow(at, "America/New_York")).toBe("2026-08-29T15:00:00");
    expect(zonedFloatingNow(at, "UTC")).toBe("2026-08-29T19:00:00");
  });

  it("produces a string that sorts against stored floating values", () => {
    // The actual comparison the DB does. A 2pm promise must NOT be overdue at 9am.
    const nineAm = zonedFloatingNow(
      new Date("2026-08-29T14:00:00.000Z"), // 09:00 Chicago
      "America/Chicago",
    );
    const promise = "2026-08-29T14:00:00"; // agreed 2pm, stored floating
    expect(promise <= nineAm).toBe(false);

    const threePm = zonedFloatingNow(
      new Date("2026-08-29T20:00:00.000Z"), // 15:00 Chicago
      "America/Chicago",
    );
    expect(promise <= threePm).toBe(true);
  });

  it("the old comparison was wrong in exactly this way", () => {
    // What the buggy code did: floating value vs a real UTC instant.
    const realUtcNow = new Date("2026-08-29T14:00:00.000Z").toISOString(); // 9am Chicago
    const promise = "2026-08-29T14:00:00"; // 2pm Chicago
    expect(promise <= realUtcNow).toBe(true); // ← "overdue" five hours early
  });

  it("falls back to UTC on a nonsense timezone instead of throwing", () => {
    const at = new Date("2026-08-29T19:00:00.000Z");
    expect(zonedFloatingNow(at, "Not/AZone")).toBe("2026-08-29T19:00:00");
  });
});

describe("floatingRelativeTime", () => {
  const now = "2026-08-29T14:00:00"; // 2pm, org wall clock

  it("reads a later promise as future, not past", () => {
    expect(floatingRelativeTime("2026-08-29T17:00:00", now)).toBe("in 3 hours");
  });

  it("reads an earlier promise as past", () => {
    expect(floatingRelativeTime("2026-08-29T12:00:00", now)).toBe("2 hours ago");
  });

  it("is zone-independent — both sides share one frame", () => {
    // Same wall-clock gap in any zone yields the same answer.
    expect(floatingRelativeTime("2026-08-29T15:00:00", "2026-08-29T14:00:00")).toBe(
      "in 1 hour",
    );
  });

  it("handles legacy values that picked up an offset, and junk", () => {
    expect(floatingRelativeTime("2026-08-29T17:00:00+00:00", now)).toBe("in 3 hours");
    expect(floatingRelativeTime(null, now)).toBe("");
    expect(floatingRelativeTime("not-a-time", now)).toBe("");
  });
});

describe("floatingToUtcIso", () => {
  it("converts a promised wall clock to the instant it names", () => {
    // 2pm Chicago in August (CDT, UTC-5) is 19:00Z.
    expect(floatingToUtcIso("2026-08-29T14:00:00", "America/Chicago")).toBe(
      "2026-08-29T19:00:00.000Z",
    );
    // 2pm New York (EDT, UTC-4) is 18:00Z.
    expect(floatingToUtcIso("2026-08-29T14:00:00", "America/New_York")).toBe(
      "2026-08-29T18:00:00.000Z",
    );
  });

  it("round-trips with zonedFloatingNow", () => {
    for (const tz of ["America/Chicago", "America/Los_Angeles", "Europe/Berlin", "UTC"]) {
      const instant = new Date("2026-08-29T19:00:00.000Z");
      const wall = zonedFloatingNow(instant, tz);
      expect(floatingToUtcIso(wall, tz)).toBe(instant.toISOString());
    }
  });

  it("respects standard time as well as daylight time", () => {
    // January: Chicago is CST (UTC-6), so 2pm is 20:00Z.
    expect(floatingToUtcIso("2026-01-15T14:00:00", "America/Chicago")).toBe(
      "2026-01-15T20:00:00.000Z",
    );
  });

  it("returns null for absent or unparseable input", () => {
    expect(floatingToUtcIso(null, "America/Chicago")).toBeNull();
    expect(floatingToUtcIso("", "America/Chicago")).toBeNull();
    expect(floatingToUtcIso("whenever", "America/Chicago")).toBeNull();
  });
});
