// Pure decision logic for human-call connect detection, shared by the
// /api/twilio/answered route and its tests. Given the live Twilio status of each
// placed homeowner leg, decide whether a leg has answered (the winner), which
// other legs to release, and whether the whole attempt is over (nobody home).

const TERMINAL = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);
const RINGING = new Set(["queued", "initiated", "ringing"]);

export interface LegStatus {
  leadId: string;
  sid: string;
  status: string;
}

export interface AnswerDecision {
  /** The first leg that's connected (in-progress), if any. */
  answeredLeadId: string | null;
  /** True once every leg has ended without anyone answering. */
  done: boolean;
  /** SIDs of the still-ringing losing legs to hang up (parallel dial). */
  release: string[];
}

export function resolveAnswer(statuses: LegStatus[]): AnswerDecision {
  const winner = statuses.find((s) => s.status === "in-progress");
  if (winner) {
    return {
      answeredLeadId: winner.leadId,
      done: false,
      release: statuses
        .filter((s) => s.sid !== winner.sid && RINGING.has(s.status))
        .map((s) => s.sid),
    };
  }
  // No winner: done once every leg has ended (an empty list is trivially done —
  // there is nothing left to wait for).
  return {
    answeredLeadId: null,
    done: statuses.every((s) => TERMINAL.has(s.status)),
    release: [],
  };
}
