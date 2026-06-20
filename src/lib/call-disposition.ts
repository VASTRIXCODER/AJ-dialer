import "server-only";

import type { CallOutcome } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic disposition for calls that never reached a live conversation.
//
// When the AI agent dials and the homeowner doesn't pick up (no answer, busy,
// voicemail, dead/invalid number) there is no transcript to reason over — so we
// categorize it deterministically instead of spending a Claude call. Shared by
// the post-call webhook and the live conversation detail route so a call that
// "doesn't go through" is always auto-filed the same way.
// ─────────────────────────────────────────────────────────────────────────────

/** Map a Twilio/ElevenLabs termination reason → the right CallOutcome. */
export function unconnectedOutcome(
  reason: string,
  _durationSec = 0,
): CallOutcome {
  const r = (reason || "").toLowerCase();
  if (/voicemail|machine|answphone|answering/.test(r)) return "voicemail";
  if (/invalid|wrong[\s_-]?number|not[\s_-]?in[\s_-]?service|unallocated|disconnected/.test(r))
    return "wrong_number";
  // no-answer / busy / timeout / canceled / unanswered all map to "no answer".
  return "no_answer";
}

const BLURBS: Partial<Record<CallOutcome, string>> = {
  no_answer:
    "No answer — the homeowner didn't pick up. Auto-categorized; re-attempt during the early-evening window.",
  voicemail:
    "Reached voicemail — no live conversation took place. Auto-categorized for a follow-up attempt.",
  wrong_number:
    "The number appears invalid or out of service. Auto-categorized as a wrong number.",
};

/** A human-readable note explaining an auto-filed disposition. */
export function dispositionBlurb(outcome: CallOutcome): string {
  return BLURBS[outcome] ?? "Call did not connect — auto-categorized by AI.";
}
