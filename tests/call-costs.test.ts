import { describe, expect, it } from "vitest";
import type { ChannelRow } from "@/lib/call-analytics";
import { costBreakdown } from "@/lib/call-costs";

const channel = (over: Partial<ChannelRow> & Pick<ChannelRow, "channel">): ChannelRow => ({
  label: over.channel === "ai" ? "AI agent" : "Human reps",
  calls: 0,
  connects: 0,
  connectRate: 0,
  appointments: 0,
  apptRate: 0,
  avgTalkSec: 0,
  totalTalkSec: 0,
  ...over,
});

const RATES = { aiPerMinute: 0.1, manualPerMinute: 0.015 };

describe("costBreakdown", () => {
  it("prices each channel at its own per-minute rate", () => {
    const out = costBreakdown(
      [
        channel({ channel: "ai", calls: 10, totalTalkSec: 600 }), // 10 min
        channel({ channel: "human", calls: 20, totalTalkSec: 1200 }), // 20 min
      ],
      RATES,
    );
    expect(out.perChannel.find((c) => c.channel === "ai")?.cost).toBe(1.0);
    expect(out.perChannel.find((c) => c.channel === "human")?.cost).toBe(0.3);
    expect(out.totalCost).toBe(1.3);
  });

  it("pro-rates partial minutes instead of rounding them away", () => {
    // 90 seconds of AI talk = 1.5 min × $0.10 = $0.15
    const out = costBreakdown([channel({ channel: "ai", totalTalkSec: 90 })], RATES);
    expect(out.perChannel[0].cost).toBe(0.15);
  });

  it("rounds money to cents and minutes to whole numbers for display", () => {
    // 100s = 1.6667 min × 0.1 = $0.1667 → $0.17; minutes display as 2
    const out = costBreakdown([channel({ channel: "ai", totalTalkSec: 100 })], RATES);
    expect(out.perChannel[0].cost).toBe(0.17);
    expect(out.perChannel[0].minutes).toBe(2);
  });

  it("computes cost per appointment across channels", () => {
    const out = costBreakdown(
      [
        channel({ channel: "ai", totalTalkSec: 600, appointments: 1 }), // $1.00
        channel({ channel: "human", totalTalkSec: 4000, appointments: 3 }), // $1.00
      ],
      RATES,
    );
    expect(out.appointments).toBe(4);
    expect(out.costPerAppointment).toBe(0.5);
  });

  it("returns null cost-per-appointment when nothing was booked", () => {
    const out = costBreakdown([channel({ channel: "ai", totalTalkSec: 600 })], RATES);
    expect(out.costPerAppointment).toBeNull();
  });

  it("never goes negative on a bad rate", () => {
    const out = costBreakdown(
      [channel({ channel: "ai", totalTalkSec: 600 })],
      { aiPerMinute: -1, manualPerMinute: 0.015 },
    );
    expect(out.perChannel[0].cost).toBe(0);
    expect(out.totalCost).toBe(0);
  });

  it("is zero across the board with no talk time", () => {
    const out = costBreakdown(
      [channel({ channel: "ai" }), channel({ channel: "human" })],
      RATES,
    );
    expect(out.totalCost).toBe(0);
    expect(out.costPerAppointment).toBeNull();
  });
});
