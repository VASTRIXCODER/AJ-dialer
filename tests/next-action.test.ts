import { describe, expect, it } from "vitest";
import {
  NEXT_ACTION_LABELS,
  nextActionForOutcome,
} from "../src/lib/opportunities/next-action";
import { whyNowLine } from "../src/lib/opportunities/why-now";

// ─────────────────────────────────────────────────────────────────────────────
// P2.3: the disposition → next-action mapping and the "why now" sentence.
// Both PURE — the sync hook and the dialer card are thin consumers.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-29T18:00:00.000Z");

describe("nextActionForOutcome", () => {
  it("callback keeps the agreed time; no time = due now (null)", () => {
    expect(
      nextActionForOutcome("callback_scheduled", {
        callbackAt: "2026-08-30T15:00:00",
        now: NOW,
      }),
    ).toEqual({ kind: "callback", dueAt: "2026-08-30T15:00:00" });
    expect(nextActionForOutcome("callback_scheduled", { now: NOW })).toEqual({
      kind: "callback",
      dueAt: null,
    });
  });

  it("appointment carries the booked slot", () => {
    expect(
      nextActionForOutcome("appointment_booked", {
        appointmentAt: "2026-09-01T10:00:00",
        now: NOW,
      }),
    ).toEqual({ kind: "attend_appointment", dueAt: "2026-09-01T10:00:00" });
  });

  it("no_answer/voicemail schedule a 2-day follow-up; qualified 1 day", () => {
    for (const outcome of ["no_answer", "voicemail"] as const) {
      const na = nextActionForOutcome(outcome, { now: NOW });
      expect(na).toMatchObject({ kind: "follow_up_call" });
      expect(na !== "clear" && na?.dueAt).toBe("2026-08-31T18:00:00.000Z");
    }
    const q = nextActionForOutcome("qualified", { now: NOW });
    expect(q !== "clear" && q?.dueAt).toBe("2026-08-30T18:00:00.000Z");
  });

  it("nurture check-in lands 30 days out", () => {
    const na = nextActionForOutcome("bills_fine", { now: NOW });
    expect(na).toMatchObject({ kind: "nurture_check_in" });
    expect(na !== "clear" && na?.dueAt).toBe("2026-09-28T18:00:00.000Z");
  });

  it("closing/dead outcomes clear; unknown leaves untouched", () => {
    expect(nextActionForOutcome("not_interested", { now: NOW })).toBe("clear");
    expect(nextActionForOutcome("do_not_call", { now: NOW })).toBe("clear");
    expect(nextActionForOutcome("wrong_number", { now: NOW })).toBe("clear");
    expect(nextActionForOutcome(null, { now: NOW })).toBeNull();
  });

  it("every kind it can stamp has a human label", () => {
    for (const outcome of [
      "callback_scheduled",
      "appointment_booked",
      "qualified",
      "no_answer",
      "bills_fine",
    ] as const) {
      const na = nextActionForOutcome(outcome, { now: NOW });
      expect(na).not.toBeNull();
      if (na && na !== "clear") {
        expect(NEXT_ACTION_LABELS[na.kind]).toBeTruthy();
      }
    }
  });
});

const baseCtx = {
  workItems: [],
  signals: [],
  nextActionKind: null,
  nextActionDueAt: null,
  attemptCount: 0,
  contactCount: 0,
  firstReceivedAt: null,
  lastTouchedAt: null,
  stage: "new",
};

describe("whyNowLine", () => {
  it("a due work item's reason outranks everything", () => {
    const line = whyNowLine(
      {
        ...baseCtx,
        workItems: [
          {
            id: "w1",
            type: "callback",
            reason: "They asked for a call before noon.",
            dueAt: "2026-08-29T17:00:00.000Z",
            priority: 5,
            status: "reserved",
          },
        ],
        signals: [
          {
            id: "s1",
            type: "callback_overdue",
            severity: 5,
            reason: "Promised callback is overdue.",
            detectedAt: "2026-08-29T16:00:00.000Z",
          },
        ],
      },
      "lead",
      NOW,
    );
    expect(line).toBe("They asked for a call before noon.");
  });

  it("hot signals beat the stage story", () => {
    const line = whyNowLine(
      {
        ...baseCtx,
        attemptCount: 3,
        contactCount: 1,
        lastTouchedAt: "2026-08-28T18:00:00.000Z",
        stage: "contacted",
        signals: [
          {
            id: "s1",
            type: "stale_hot",
            severity: 4,
            reason: "Was hot 3 days ago and untouched since.",
            detectedAt: "2026-08-29T12:00:00.000Z",
          },
        ],
      },
      "lead",
      NOW,
    );
    expect(line).toBe("Was hot 3 days ago and untouched since.");
  });

  it("fresh lead uses the workspace's own noun", () => {
    const line = whyNowLine(
      { ...baseCtx, firstReceivedAt: "2026-08-29T17:30:00.000Z" },
      "homeowner",
      NOW,
    );
    expect(line).toContain("Fresh homeowner — never called.");
  });

  it("attempted-but-never-reached says so with the next attempt number", () => {
    const line = whyNowLine(
      { ...baseCtx, attemptCount: 2, stage: "attempting" },
      "lead",
      NOW,
    );
    expect(line).toBe("Attempt #3 — no conversation yet.");
  });

  it("a future work item renders with its due time, not as overdue", () => {
    const line = whyNowLine(
      {
        ...baseCtx,
        attemptCount: 1,
        contactCount: 1,
        stage: "contacted",
        workItems: [
          {
            id: "w2",
            type: "follow_up_call",
            reason: "Follow up on the quote.",
            dueAt: "2026-08-30T18:00:00.000Z",
            priority: 0,
            status: "pending",
          },
        ],
      },
      "lead",
      NOW,
    );
    expect(line).toContain("Follow up on the quote.");
    expect(line).toContain("Due");
  });
});
