import { describe, expect, it } from "vitest";
import {
  actorLabel,
  executionCopy,
  humanizeSlug,
  instanceStatusCopy,
  opportunityEventCopy,
  workReasonLabel,
  workTypeLabel,
} from "@/lib/opportunities/event-copy";
import { STAGES } from "@/lib/opportunities/stage-machine";

// The single rule this module exists to enforce: nothing the database calls a
// thing may reach a screen looking like a database called it that.
const SCHEMA_ISH = /_|^[a-z]+:[a-z]/;

describe("stage changes read as sentences", () => {
  it("names both ends of the move", () => {
    const c = opportunityEventCopy({
      type: "stage_changed",
      actorKind: "rep",
      fromStage: "contacted",
      toStage: "interested",
    });
    expect(c.title).toBe("Contacted → Interested");
  });

  it("prefers a real person's name over their role", () => {
    const named = opportunityEventCopy({
      type: "stage_changed",
      actorKind: "manager",
      actorName: "Dana Reed",
      toStage: "sold",
    });
    expect(named.detail).toContain("Dana Reed");
    expect(named.detail).not.toContain("A manager");
  });

  it("calls the engine what a human would call it", () => {
    expect(actorLabel("system")).toBe("Automation");
    expect(actorLabel("ai")).toBe("The AI agent");
  });

  it("translates the reasons the writers actually record", () => {
    const stop = opportunityEventCopy({
      type: "stage_changed",
      actorKind: "system",
      toStage: "dnc_suppressed",
      detail: { reason: "sms_stop" },
    });
    expect(stop.detail).toContain("they replied STOP");
    expect(stop.tone).toBe("danger");
  });

  it("colours the endings by what they mean", () => {
    const won = opportunityEventCopy({ type: "stage_changed", actorKind: "manager", toStage: "sold" });
    const lost = opportunityEventCopy({ type: "stage_changed", actorKind: "rep", toStage: "lost" });
    expect(won.tone).toBe("success");
    expect(lost.tone).toBe("warning");
  });

  it("never renders a raw stage key for ANY stage", () => {
    for (const stage of STAGES) {
      const c = opportunityEventCopy({ type: "stage_changed", actorKind: "rep", toStage: stage });
      expect(c.title, `raw key leaked for ${stage}`).not.toMatch(SCHEMA_ISH);
    }
  });

  it("still describes an event type it has never seen", () => {
    // These tables carry unconstrained text; hiding an unknown row would make
    // the history look shorter than it is.
    const c = opportunityEventCopy({ type: "priority_changed", actorKind: "system" });
    expect(c.title).toBe("Priority changed");
  });
});

describe("playbook steps say what happened", () => {
  it("numbers steps from one, because nobody counts from zero out loud", () => {
    const c = executionCopy({ stepIndex: 0, actionKind: "create_work_item", status: "succeeded" });
    expect(c.title).toBe("Step 1 · Created a task");
  });

  it("explains a step the automation deliberately held back", () => {
    // This is the whole reason the tab exists: a capped playbook used to look
    // simply idle, with the decision to wait recorded where nobody could see it.
    const c = executionCopy({
      stepIndex: 1,
      actionKind: "create_work_item",
      status: "skipped_policy",
      detail: { reason: "touches_per_day_cap" },
    });
    expect(c.title).toContain("held back");
    expect(c.detail).toBe("Touches per day cap");
    expect(c.tone).toBe("warning");
  });

  it("shows a failure's actual error rather than a shrug", () => {
    const c = executionCopy({
      stepIndex: 2,
      actionKind: "escalate",
      status: "failed",
      error: "signals insert rejected",
    });
    expect(c.detail).toBe("signals insert rejected");
    expect(c.tone).toBe("danger");
  });

  it("says something when the error was not recorded", () => {
    const c = executionCopy({ stepIndex: 0, actionKind: "escalate", status: "failed" });
    expect(c.detail).toBe("No reason was recorded.");
  });
});

describe("a stopped run is usually good news", () => {
  it("says WHY it stopped, so it doesn't read as a fault", () => {
    const c = instanceStatusCopy({
      status: "stopped",
      currentStep: 2,
      stoppedReason: "appointment_booked",
    });
    expect(c.detail).toBe("Stopped because an appointment was booked.");
    // A playbook that got out of the way because the outcome happened is the
    // system working, and the tone has to agree with the words.
    expect(c.tone).toBe("success");
  });

  it("handles an opt-out stop in plain language", () => {
    const c = instanceStatusCopy({
      status: "stopped",
      currentStep: 0,
      stoppedReason: "dnc_or_opt_out",
    });
    expect(c.detail).toContain("asked not to be contacted");
  });

  it("softens a stop reason it has no phrasing for", () => {
    const c = instanceStatusCopy({
      status: "stopped",
      currentStep: 1,
      stoppedReason: "some_future_rule",
    });
    expect(c.detail).toBe("Stopped because Some future rule.");
  });

  it("reports a live run by the step a human would count", () => {
    expect(instanceStatusCopy({ status: "active", currentStep: 0 }).detail).toBe("On step 1");
  });
});

describe("work-item copy", () => {
  it("names the types the playbooks actually create", () => {
    expect(workTypeLabel("first_call")).toBe("First call");
    expect(workTypeLabel("hot_response")).toBe("Hot response");
  });

  it("softens an author-supplied type it has never seen", () => {
    expect(workTypeLabel("door_knock")).toBe("Door knock");
  });

  it("softens author-supplied reasons", () => {
    expect(workReasonLabel("speed_to_lead_breach")).toBe("Speed to lead breach");
  });

  it("returns empty for empty rather than a stray capital", () => {
    expect(workReasonLabel("")).toBe("");
    expect(humanizeSlug("")).toBe("");
  });
});
