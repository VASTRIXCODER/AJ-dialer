import type { PillState } from "@/components/ui/status-pill";
import type { FloorCallState } from "@/lib/realtime/events";
import type { DialLine } from "@/lib/use-dialer";

// ─────────────────────────────────────────────────────────────────────────────
// Lane state maps — PURE. The dialer's lanes and the AI session rows both
// render StatusPill, whose vocabulary is the canonical AttemptState machine
// (docs/phase-1/call-state-machine.md). These maps are the ONE place the
// engine's lane words (DialLine.status) and the floor channel's lifecycle
// words (FloorCallState) translate into that vocabulary — so a lane can never
// invent its own label and every surface reads the same state the same way.
// Both maps are TOTAL (`satisfies Record<…>`), and a test asserts it.
// ─────────────────────────────────────────────────────────────────────────────

export type LaneStatus = DialLine["status"];

/** DialLine.status → the canonical pill. Total by construction. */
export const LANE_STATUS_TO_PILL = {
  ringing: "ringing",
  connected: "human_connected",
  // "canceled" on a lane means WE released it (the round ended or another
  // lane won) — the machine's word for a leg we hung up before an answer.
  canceled: "canceled",
  no_answer: "no_answer",
} as const satisfies Record<LaneStatus, PillState>;

export function laneStateToPill(status: LaneStatus): PillState {
  return LANE_STATUS_TO_PILL[status];
}

/** A lane state that means "this lane is done" (shows a termination reason). */
export function isLaneEnded(status: LaneStatus): boolean {
  return status === "canceled" || status === "no_answer";
}

/**
 * Why an ended lane ended, in words a rep should read. `anotherAnswered`
 * distinguishes the parallel-race loser (released because a different lane
 * won) from a plain cancel (the rep pressed Cancel / the round timed out).
 */
export function laneTerminationReason(
  status: LaneStatus,
  opts: { anotherAnswered?: boolean; refusal?: string | null } = {},
): string | null {
  switch (status) {
    case "canceled":
      // A refusal the SERVER gave a reason for — a contact outside their own
      // calling hours, most often. That string used to be composed by the dial
      // route, sent back per leg, and thrown away by the client, so every
      // refusal looked identical to "another line answered" and a rep watching
      // three lanes cancel had no way to tell a policy from a race.
      if (opts.refusal) return opts.refusal;
      return opts.anotherAnswered ? "Released — another line answered" : "Released";
    case "no_answer":
      return "No answer";
    default:
      return null;
  }
}

// ── AI session rows (floor channel lifecycle → canonical pill) ───────────────

/** FloorCallState (the `call.state` broadcast vocabulary) → pill, pre-verdict. */
export const AI_FLOOR_STATE_TO_PILL = {
  calling: "initiated",
  ringing: "ringing",
  connected: "in_progress",
  // "ended" alone has no verdict — aiCallPill refines it by termination reason.
  ended: "completed",
} as const satisfies Record<FloorCallState, PillState>;

/**
 * Resolve the pill for an AI call from its floor-channel state, refining a bare
 * "ended" by the termination reason when one rode along (no_answer | busy |
 * voicemail | failed | canceled | declined → their canonical states; anything
 * else — including a missing reason — is an honest "completed").
 */
export function aiCallPill(
  state: FloorCallState,
  terminationReason?: string | null,
): PillState {
  if (state !== "ended") return AI_FLOOR_STATE_TO_PILL[state];
  const r = (terminationReason ?? "").toLowerCase();
  if (r.includes("no_answer") || r.includes("no-answer")) return "no_answer";
  if (r.includes("voicemail") || r.includes("machine")) return "voicemail_connected";
  if (r.includes("busy")) return "busy";
  if (r.includes("decline") || r.includes("reject")) return "declined";
  if (r.includes("cancel")) return "canceled";
  if (r.includes("fail") || r.includes("error")) return "failed";
  return "completed";
}
