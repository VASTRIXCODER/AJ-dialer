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
  /**
   * SIDs of the non-winning legs to hang up (parallel dial): still-ringing losers
   * AND any SECOND leg that also answered (double-answer). See the note in
   * resolveAnswer for why releasing an answered leg is safe here.
   */
  release: string[];
}

export function resolveAnswer(statuses: LegStatus[]): AnswerDecision {
  const winner = statuses.find((s) => s.status === "in-progress");
  if (winner) {
    return {
      answeredLeadId: winner.leadId,
      done: false,
      // Release every OTHER active leg — still-ringing losers AND a second leg
      // that ALSO answered in the same window (double-answer). The browser
      // bridges the rep to THIS winner, so a second answered homeowner would
      // otherwise sit in the same conference hearing the rep's pitch (a
      // two-party-consent / privacy incident) with no way to remove just them.
      // Safe here because this poll is the browser's own authority for which leg
      // the rep is on — unlike the status webhook, which must never hang up an
      // answered leg (the two can disagree on the winner).
      release: statuses
        .filter(
          (s) =>
            s.sid !== winner.sid &&
            (RINGING.has(s.status) || s.status === "in-progress"),
        )
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
