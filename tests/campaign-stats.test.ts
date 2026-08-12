import { describe, expect, it } from "vitest";
import { emptyVariantStats, scriptTestForCampaign } from "@/lib/campaign-stats";

const CAMP = "camp-1";
const row = (
  outcome: string | null,
  script_variant: string | null,
  campaign_id: string = CAMP,
) => ({ campaign_id, outcome, script_variant });

describe("scriptTestForCampaign", () => {
  it("returns empty stats for no calls", () => {
    const split = scriptTestForCampaign(CAMP, []);
    expect(split.a).toEqual(emptyVariantStats());
    expect(split.b).toEqual(emptyVariantStats());
  });

  it("splits calls, connects and appointments per variant", () => {
    const calls = [
      row("appointment_booked", "a"),
      row("qualified", "a"),
      row("no_answer", "a"),
      row("no_answer", "a"),
      row("not_interested", "b"),
      row("no_answer", "b"),
    ];
    const split = scriptTestForCampaign(CAMP, calls);
    expect(split.a).toEqual({
      calls: 4,
      connects: 2,
      connectRate: 50,
      appointments: 1,
      apptRate: 50,
    });
    expect(split.b).toEqual({
      calls: 2,
      connects: 1,
      connectRate: 50,
      appointments: 0,
      apptRate: 0,
    });
  });

  it("ignores null-variant rows (auto-filed no-answers carry no script context)", () => {
    const calls = [
      row("appointment_booked", "a"),
      // recordNonWinners files parallel-dial losers with no script context.
      row("no_answer", null),
      row("no_answer", null),
      row(null, null),
    ];
    const split = scriptTestForCampaign(CAMP, calls);
    expect(split.a.calls).toBe(1);
    expect(split.a.connectRate).toBe(100);
    expect(split.b.calls).toBe(0);
  });

  it("ignores unknown variant values rather than crashing", () => {
    const calls = [row("qualified", "c"), row("qualified", "A"), row("qualified", "b")];
    const split = scriptTestForCampaign(CAMP, calls);
    expect(split.a.calls).toBe(0);
    expect(split.b.calls).toBe(1);
  });

  it("only counts rows belonging to the campaign", () => {
    const calls = [
      row("qualified", "a"),
      row("qualified", "a", "other-campaign"),
      { outcome: "qualified", script_variant: "a" }, // no campaign_id at all
    ];
    const split = scriptTestForCampaign(CAMP, calls);
    expect(split.a.calls).toBe(1);
  });

  it("rates come back as one-decimal percentages", () => {
    const calls = [
      row("qualified", "a"),
      row("no_answer", "a"),
      row("no_answer", "a"),
    ];
    const split = scriptTestForCampaign(CAMP, calls);
    expect(split.a.connectRate).toBe(33.3);
    expect(split.a.apptRate).toBe(0);
  });
});
