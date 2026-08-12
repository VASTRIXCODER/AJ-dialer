import { describe, expect, it } from "vitest";
import type { AutomationSettings } from "@/lib/org/settings";
import { isWithinCallingWindow, zonedDayHour } from "@/lib/dialer/schedule";

// 2026-08-12 15:30 UTC → 10:30 in America/Chicago (CDT), 11:30 in America/New_York.
const NOW = new Date("2026-08-12T15:30:00Z");
const TZ = "America/Chicago";

function automation(overrides: Partial<AutomationSettings>): AutomationSettings {
  return {
    enabled: true,
    timezone: TZ,
    days: [0, 1, 2, 3, 4, 5, 6],
    windows: [{ start: 10, end: 11 }],
    callsPerRun: 3,
    dailyCap: 0,
    cooldownHours: 6,
    ...overrides,
  };
}

describe("isWithinCallingWindow", () => {
  it("is true inside the window in the given timezone", () => {
    expect(isWithinCallingWindow(NOW, automation({}), TZ)).toBe(true); // 10:30 CDT ∈ [10,11)
  });

  it("is false outside the window", () => {
    expect(isWithinCallingWindow(NOW, automation({ windows: [{ start: 11, end: 12 }] }), TZ)).toBe(
      false,
    );
  });

  it("evaluates the window in the LEAD's zone, not the org's (the TCPA fix)", () => {
    // Same instant is 11:30 in New York — outside a 10–11 window there.
    expect(isWithinCallingWindow(NOW, automation({}), "America/New_York")).toBe(false);
  });

  it("respects the master switch and empty windows", () => {
    expect(isWithinCallingWindow(NOW, automation({ enabled: false }), TZ)).toBe(false);
    expect(isWithinCallingWindow(NOW, automation({ windows: [] }), TZ)).toBe(false);
    expect(isWithinCallingWindow(NOW, null, TZ)).toBe(false);
  });

  it("honors the day-of-week filter", () => {
    const { day } = zonedDayHour(NOW, TZ);
    expect(isWithinCallingWindow(NOW, automation({ days: [day] }), TZ)).toBe(true);
    expect(isWithinCallingWindow(NOW, automation({ days: [(day + 1) % 7] }), TZ)).toBe(false);
  });
});
