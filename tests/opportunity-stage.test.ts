import { describe, expect, it } from "vitest";
import {
  ALTERNATE_STAGES,
  canTransition,
  isClosingStage,
  PROGRESSIVE_STAGES,
  STAGES,
  stageForLeadStatus,
  stageRank,
  type OpportunityStage,
} from "@/lib/opportunities/stage-machine";

// ─────────────────────────────────────────────────────────────────────────────
// The sales lifecycle machine (P2.1). The rules under test are the prompt's
// §5 non-negotiables: forward-free, backward-human-only, sold-trusted-only,
// DNC-leaves-only-by-human.
// ─────────────────────────────────────────────────────────────────────────────

describe("stage machine — ranks and shape", () => {
  it("progressive ladder ranks strictly increase; alternates rank -1", () => {
    for (let i = 1; i < PROGRESSIVE_STAGES.length; i++) {
      expect(stageRank(PROGRESSIVE_STAGES[i])).toBeGreaterThan(
        stageRank(PROGRESSIVE_STAGES[i - 1]),
      );
    }
    for (const alt of ALTERNATE_STAGES) expect(stageRank(alt)).toBe(-1);
  });
});

describe("stage machine — transition rules (exhaustive over the matrix)", () => {
  it("forward moves are free for every actor; ladder regressions need a human with allowRegress", () => {
    for (const from of PROGRESSIVE_STAGES) {
      for (const to of PROGRESSIVE_STAGES) {
        if (from === to) continue;
        const forward = stageRank(to) > stageRank(from);
        const system = canTransition(from, to, "system");
        if (to === "sold") {
          // Sold is gated whatever the direction — checked separately below.
          expect(system.ok).toBe(false);
          continue;
        }
        if (forward) {
          expect(system.ok).toBe(true);
        } else {
          expect(system.ok).toBe(false);
          if (!system.ok) expect(system.reason).toBe("regress_needs_human");
          // A manager with the explicit override may regress…
          expect(canTransition(from, to, "manager", { allowRegress: true }).ok).toBe(true);
          // …but AI never may, override or not.
          expect(canTransition(from, to, "ai", { allowRegress: true }).ok).toBe(false);
        }
      }
    }
  });

  it("sold requires the trusted actor — never AI, never a generic system writer", () => {
    for (const actor of ["rep", "ai", "system"] as const) {
      const v = canTransition("appointment_completed", "sold", actor);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toBe("sold_needs_trusted_actor");
    }
    expect(canTransition("appointment_completed", "sold", "manager").ok).toBe(true);
    expect(
      canTransition("appointment_completed", "sold", "system_fulfillment").ok,
    ).toBe(true);
  });

  it("dnc_suppressed is enterable from anywhere, leavable only by a manager", () => {
    for (const from of STAGES) {
      if (from === "dnc_suppressed") continue;
      expect(canTransition(from as OpportunityStage, "dnc_suppressed", "system").ok).toBe(
        true,
      );
    }
    expect(canTransition("dnc_suppressed", "contacted", "system").ok).toBe(false);
    expect(canTransition("dnc_suppressed", "contacted", "ai").ok).toBe(false);
    expect(canTransition("dnc_suppressed", "contacted", "manager").ok).toBe(true);
  });

  it("climbing OUT of a holding stage is a free forward move", () => {
    expect(canTransition("nurture", "contacted", "system").ok).toBe(true);
    expect(canTransition("lost", "interested", "rep").ok).toBe(true);
  });

  it("same-stage and unknown stages are refused", () => {
    expect(canTransition("new", "new", "manager").ok).toBe(false);
    expect(
      canTransition("banana" as OpportunityStage, "new", "manager").ok,
    ).toBe(false);
  });
});

describe("leads.status → stage mapping (LOCKSTEP with the PART 37 backfill)", () => {
  it("maps every Phase 1 status", () => {
    expect(stageForLeadStatus("new", false)).toBe("new");
    expect(stageForLeadStatus("new", true)).toBe("assigned");
    expect(stageForLeadStatus("no_answer", false)).toBe("attempting");
    expect(stageForLeadStatus("contacted", false)).toBe("contacted");
    expect(stageForLeadStatus("callback", false)).toBe("contacted");
    expect(stageForLeadStatus("qualified", false)).toBe("interested");
    expect(stageForLeadStatus("appointment", false)).toBe("appointment_booked");
    expect(stageForLeadStatus("bills_fine", false)).toBe("nurture");
    expect(stageForLeadStatus("not_interested", false)).toBe("lost");
    expect(stageForLeadStatus("dnc", false)).toBe("dnc_suppressed");
  });

  it("every ending closes, and the two non-endings stay open", () => {
    // `sold` stays open because fulfillment mirroring still works the record,
    // and `nurture` stays open because it is a holding pattern with a review
    // date, not an ending. The other six all close: an open opportunity with
    // no next action and no live work item is reported by app_pipeline_leaks
    // every day forever, so a record parked at `invalid` or `duplicate` while
    // still marked open would send a supervisor chasing a wrong number that
    // can never be fixed.
    const closing = STAGES.filter((s) => isClosingStage(s));
    expect(closing.slice().sort()).toEqual([
      "disqualified",
      "dnc_suppressed",
      "duplicate",
      "exhausted",
      "invalid",
      "lost",
    ]);
    expect(isClosingStage("sold")).toBe(false);
    expect(isClosingStage("nurture")).toBe(false);
  });

  it("no progressive stage closes — the ladder is all still in play", () => {
    for (const s of PROGRESSIVE_STAGES) expect(isClosingStage(s)).toBe(false);
  });
});
