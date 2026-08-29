import { describe, expect, it } from "vitest";
import {
  AI_FLOOR_STATE_TO_PILL,
  aiCallPill,
  isLaneEnded,
  LANE_STATUS_TO_PILL,
  laneStateToPill,
  laneTerminationReason,
  type LaneStatus,
} from "@/lib/dialer/lane-state";

// ─────────────────────────────────────────────────────────────────────────────
// The lane → StatusPill vocabulary maps. Totality is enforced at compile time
// (`satisfies Record<…>`); these tests pin the actual WORDS so an engine lane
// state or a floor lifecycle word can never quietly change which canonical
// pill it renders as.
// ─────────────────────────────────────────────────────────────────────────────

const ALL_LANE_STATUSES: LaneStatus[] = ["ringing", "connected", "canceled", "no_answer"];

describe("lane status → canonical pill (total)", () => {
  it("maps every engine lane status", () => {
    for (const status of ALL_LANE_STATUSES) {
      expect(LANE_STATUS_TO_PILL[status]).toBeTruthy();
      expect(laneStateToPill(status)).toBe(LANE_STATUS_TO_PILL[status]);
    }
    expect(Object.keys(LANE_STATUS_TO_PILL).sort()).toEqual([...ALL_LANE_STATUSES].sort());
  });

  it("pins the exact canonical words", () => {
    expect(laneStateToPill("ringing")).toBe("ringing");
    expect(laneStateToPill("connected")).toBe("human_connected");
    expect(laneStateToPill("canceled")).toBe("canceled");
    expect(laneStateToPill("no_answer")).toBe("no_answer");
  });

  it("knows which lane states are terminal", () => {
    expect(isLaneEnded("ringing")).toBe(false);
    expect(isLaneEnded("connected")).toBe(false);
    expect(isLaneEnded("canceled")).toBe(true);
    expect(isLaneEnded("no_answer")).toBe(true);
  });
});

describe("laneTerminationReason", () => {
  it("live lanes have no termination reason", () => {
    expect(laneTerminationReason("ringing")).toBeNull();
    expect(laneTerminationReason("connected")).toBeNull();
  });

  it("distinguishes the parallel-race loser from a plain cancel", () => {
    expect(laneTerminationReason("canceled", { anotherAnswered: true })).toBe(
      "Released — another line answered",
    );
    expect(laneTerminationReason("canceled")).toBe("Released");
  });

  it("names a no-answer", () => {
    expect(laneTerminationReason("no_answer")).toBe("No answer");
  });
});

describe("AI floor lifecycle → canonical pill (total)", () => {
  it("maps every floor call state", () => {
    expect(Object.keys(AI_FLOOR_STATE_TO_PILL).sort()).toEqual(
      ["calling", "connected", "ended", "ringing"].sort(),
    );
    expect(aiCallPill("calling")).toBe("initiated");
    expect(aiCallPill("ringing")).toBe("ringing");
    expect(aiCallPill("connected")).toBe("in_progress");
  });

  it("refines a bare 'ended' by the termination reason", () => {
    expect(aiCallPill("ended", "no_answer")).toBe("no_answer");
    expect(aiCallPill("ended", "no-answer")).toBe("no_answer");
    expect(aiCallPill("ended", "voicemail")).toBe("voicemail_connected");
    expect(aiCallPill("ended", "machine_detected")).toBe("voicemail_connected");
    expect(aiCallPill("ended", "busy")).toBe("busy");
    expect(aiCallPill("ended", "declined")).toBe("declined");
    expect(aiCallPill("ended", "canceled")).toBe("canceled");
    expect(aiCallPill("ended", "failed")).toBe("failed");
    expect(aiCallPill("ended", "twilio_error")).toBe("failed");
  });

  it("an ended call with no (or an unknown) reason is an honest 'completed'", () => {
    expect(aiCallPill("ended")).toBe("completed");
    expect(aiCallPill("ended", null)).toBe("completed");
    expect(aiCallPill("ended", "booked")).toBe("completed");
  });

  it("a pre-terminal state ignores any stray termination reason", () => {
    expect(aiCallPill("connected", "no_answer")).toBe("in_progress");
  });
});
