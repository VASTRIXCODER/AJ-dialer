import { describe, expect, it } from "vitest";
import {
  BOARD_LANES,
  CLOSE_REASONS,
  LANE_STAGES,
  laneCopy,
  laneEntryStage,
  laneForStage,
  legalDropLanes,
} from "@/lib/opportunities/board";
import {
  isClosingStage,
  STAGES,
  type OpportunityStage,
} from "@/lib/opportunities/stage-machine";

describe("every stage lands somewhere", () => {
  it("covers all 15 stages exactly once", () => {
    // The lockstep guard: adding a stage to the machine without placing it on
    // the board would drop its cards off the pipeline silently.
    const placed = BOARD_LANES.flatMap((l) => LANE_STAGES[l]);
    expect(placed.slice().sort()).toEqual(STAGES.slice().sort());
    expect(new Set(placed).size).toBe(STAGES.length);
  });

  it("resolves a lane for every stage", () => {
    for (const s of STAGES) expect(BOARD_LANES).toContain(laneForStage(s));
  });

  it("puts nurture in its own lane, not with the closed ones", () => {
    // nurture is op_status='open' with a review date — live pipeline. Filing it
    // under Closed would hide a re-workable population behind "don't look here".
    expect(laneForStage("nurture")).toBe("parked");
    expect(isClosingStage("nurture")).toBe(false);
  });

  it("the closed lane holds exactly the stages that close the opportunity", () => {
    for (const s of LANE_STAGES.closed) expect(isClosingStage(s)).toBe(true);
    const closing = STAGES.filter(isClosingStage);
    expect(LANE_STAGES.closed.slice().sort()).toEqual(closing.slice().sort());
  });

  it("sold sits alone in Won and does not close", () => {
    expect(LANE_STAGES.won).toEqual(["sold"]);
    expect(isClosingStage("sold")).toBe(false);
  });
});

describe("drop targets come from the stage machine, not from the layout", () => {
  it("a rep cannot drag anything into Won — sold needs a trusted actor", () => {
    expect(legalDropLanes("contacted", "rep")).not.toContain("won");
    expect(legalDropLanes("contacted", "manager")).toContain("won");
  });

  it("a rep cannot drag backwards without an explicit regress", () => {
    expect(legalDropLanes("interested", "rep")).not.toContain("working");
    expect(legalDropLanes("interested", "rep", { allowRegress: true })).toContain("working");
  });

  it("nothing leaves suppression except by a manager's hand", () => {
    expect(legalDropLanes("dnc_suppressed", "rep")).toEqual([]);
    expect(legalDropLanes("dnc_suppressed", "ai")).toEqual([]);
    expect(legalDropLanes("dnc_suppressed", "manager").length).toBeGreaterThan(0);
  });

  it("a lane is never a drop target for a card already in it", () => {
    for (const s of STAGES) {
      expect(legalDropLanes(s, "manager", { allowRegress: true })).not.toContain(
        laneForStage(s),
      );
    }
  });

  it("Closed is offered to anyone, because entering an alternate is lateral", () => {
    expect(legalDropLanes("new", "rep")).toContain("closed");
    expect(legalDropLanes("appointment_booked", "rep")).toContain("closed");
  });
});

describe("the two lanes that refuse to guess", () => {
  it("New and Closed have no single entry stage", () => {
    // Closed has six different meanings and New is where records begin.
    expect(laneEntryStage("new")).toBeNull();
    expect(laneEntryStage("closed")).toBeNull();
  });

  it("the other four resolve to a stage inside themselves", () => {
    for (const lane of ["working", "committed", "won", "parked"] as const) {
      const entry = laneEntryStage(lane);
      expect(entry).not.toBeNull();
      expect(LANE_STAGES[lane]).toContain(entry as OpportunityStage);
    }
  });

  it("every close reason is a real closing stage, and they cover the lane", () => {
    for (const r of CLOSE_REASONS) expect(isClosingStage(r.stage)).toBe(true);
    expect(CLOSE_REASONS.map((r) => r.stage).sort()).toEqual(
      LANE_STAGES.closed.slice().sort(),
    );
  });

  it("every close reason states what it means", () => {
    for (const r of CLOSE_REASONS) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("copy carries the workspace's own words and no industry noun", () => {
  it("threads the appointment noun into the Committed lane", () => {
    expect(laneCopy("committed", "showing").blurb).toContain("showing");
    expect(laneCopy("committed", "interview").blurb).toContain("interview");
  });

  it("never hardcodes a vertical's vocabulary", () => {
    const banned = /homeowner|solar|bill|panel|roof/i;
    for (const lane of BOARD_LANES) {
      const c = laneCopy(lane, "account review");
      expect(c.label).not.toMatch(banned);
      expect(c.blurb).not.toMatch(banned);
      expect(c.empty).not.toMatch(banned);
    }
  });

  it("gives every lane a heading, a blurb and an empty line", () => {
    for (const lane of BOARD_LANES) {
      const c = laneCopy(lane, "account review");
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(0);
      // An empty lane states a fact rather than reserving blank height.
      expect(c.empty.length).toBeGreaterThan(0);
    }
  });
});
