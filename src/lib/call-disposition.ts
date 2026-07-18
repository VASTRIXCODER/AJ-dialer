import type { CallOutcome } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic classification for calls that never reached a live conversation.
//
// Pure — no DB or server imports — so the rules below can be unit-tested directly
// (see scripts/verify-disposition.ts), the same way call-analytics.ts and
// leaderboard.ts are. Given that mis-classifying one call type as another is what
// hid a total outage for days, these rules need to be independently testable.
//
// THE INCIDENT THIS EXISTS TO PREVENT
// The previous version of this file took a `_durationSec` argument and never
// read it, and could only ever return no_answer | voicemail | wrong_number. So
// EVERY way a call could fail collapsed into "no_answer" — including a call that
// the homeowner *answered* and that the agent then killed 2 seconds later. 283
// such calls were filed as "No answer — the homeowner didn't pick up", which is
// how a total outage of the AI agent hid for days behind a plausible-looking
// no-answer rate. A 25-second answered call was filed the same way.
//
// The fix is to separate two genuinely different things:
//
//   · An OUTCOME is a fact about the HOMEOWNER — they didn't pick up, we got
//     their voicemail, the number is dead. It counts as a real dial and belongs
//     in the connect-rate denominator.
//
//   · A FAILURE is a fact about OUR SYSTEM — the agent was misconfigured and hung
//     up, the provider errored, the call was never actually placed. It tells us
//     NOTHING about the homeowner, must never be counted as "they didn't answer",
//     and must never move the lead out of the redial pool.
//
// Failures carry `outcome: null`, which `isResolved()` (analytics/window.ts)
// already excludes from every rate denominator, so they land in `funnel.pending`
// instead of quietly deflating the connect rate.
// ─────────────────────────────────────────────────────────────────────────────

/** Why a call produced no conversation — a fault in OUR system, not the homeowner. */
export type FailureKind =
  /** OUT OF CREDITS. The homeowner answered, the agent started its greeting, and
   *  the provider killed the call mid-sentence ("This request exceeds your quota
   *  limit", duration 0:02, cost 0 credits). This was the actual cause of the
   *  zero-connect outage: 283 calls, every one filed as "no answer". */
  | "provider_quota_exceeded"
  /** Answered, then the agent hung up in <5s with no transcript, for a reason we
   *  couldn't pin down — typically a conversation_config_override the agent isn't
   *  allowed to accept. Same visible signature as a quota kill. */
  | "agent_terminated_on_connect"
  /** Answered and stayed up, but the homeowner never spoke, with no independent
   *  signal (see `voicemailSignal`) confirming it was voicemail: could still be
   *  voicemail we couldn't detect, or a broken audio path. Review the recording. */
  | "answered_no_human_turn"
  /** ElevenLabs reported an explicit error on the conversation. */
  | "provider_error"
  /** Bridge mode: the homeowner's Twilio leg was never dialed. Nobody was called. */
  | "bridge_dial_failed"
  /** Bridge mode: the homeowner was dialed but the agent never joined the room. */
  | "bridge_join_failed"
  /** The provider rejected the outbound call — it was never placed. */
  | "not_placed"
  /** We can no longer determine what happened (conversation expired / 404). */
  | "unresolvable";

export type NonConversation =
  | { kind: "outcome"; outcome: CallOutcome; summary: string }
  | { kind: "failure"; failureKind: FailureKind; summary: string };

/**
 * Below this, an answered call that produced no transcript is a system fault,
 * not a homeowner behaviour. A real person who picks up and immediately hangs up
 * still takes longer than this, and the agent's own greeting alone runs past it.
 */
const KILL_ON_CONNECT_MAX_SEC = 5;

/**
 * "You are out of credits", in every phrasing we've seen it.
 * ElevenLabs says: "This request exceeds your quota limit."
 * Lives here (pure, testable) rather than in the API client, because getting this
 * match wrong is what turns an empty wallet back into a phantom no-answer.
 */
const QUOTA_RE =
  /quota|out of credit|insufficient|exceeds your (quota|limit)|payment required|\b402\b/i;

export function isQuotaMessage(s: string | null | undefined): boolean {
  return QUOTA_RE.test(s ?? "");
}

const VOICEMAIL_RE = /voicemail|machine|answphone|answering/i;
const DEAD_NUMBER_RE =
  /invalid|wrong[\s_-]?number|not[\s_-]?in[\s_-]?service|unallocated|disconnected/i;
const NO_ANSWER_RE = /no[\s_-]?answer|busy|timeout|timed[\s_-]?out|cancel|unanswered|no[\s_-]?response/i;

const FAILURE_SUMMARY: Record<FailureKind, string> = {
  provider_quota_exceeded:
    "OUT OF CREDITS — the homeowner ANSWERED, the agent began speaking, and the voice provider " +
    "killed the call mid-greeting because the account is out of quota. The homeowner picked up and " +
    "heard half a sentence. This is NOT a no-answer, and this lead has effectively been burned for " +
    "nothing. Top up the ElevenLabs balance before dialing again.",
  agent_terminated_on_connect:
    "SYSTEM FAULT — the homeowner ANSWERED and the agent ended the call within seconds, with no " +
    "transcript. This is the signature of ElevenLabs rejecting a conversation_config_override the " +
    "agent isn't allowed to accept: check the agent's Security → Overrides toggles against " +
    "ELEVENLABS_USE_DASHBOARD_PROMPT. This is NOT a homeowner no-answer — do not treat it as one.",
  answered_no_human_turn:
    "The call was answered but the homeowner never spoke — most likely voicemail (answering-machine " +
    "detection is not enabled), or a one-way audio path. Review the recording before re-dialing.",
  provider_error:
    "The voice provider returned an error for this call. No conversation took place; this is a " +
    "system fault, not a homeowner outcome.",
  bridge_dial_failed:
    "SYSTEM FAULT — the homeowner was never dialed. The outbound leg was rejected by Twilio, so " +
    "nobody's phone rang. The lead has NOT been contacted and remains due for a first attempt.",
  bridge_join_failed:
    "SYSTEM FAULT — the homeowner was dialed but the AI agent never joined the call, so they were " +
    "left in an empty room. Treat as a bad experience and re-attempt.",
  not_placed:
    "The call was never placed — the provider rejected it at dial time. The lead has NOT been " +
    "contacted.",
  unresolvable:
    "This call could not be reconciled — the provider no longer has a record of it. Its true outcome " +
    "is unknown, so it is deliberately left un-dispositioned rather than guessed at.",
};

const OUTCOME_SUMMARY: Partial<Record<CallOutcome, string>> = {
  no_answer:
    "No answer — the homeowner didn't pick up. Auto-categorized; re-attempt during the early-evening window.",
  voicemail:
    "Reached voicemail — no live conversation took place. Auto-categorized for a follow-up attempt.",
  wrong_number:
    "The number appears invalid or out of service. Auto-categorized as a wrong number.",
};

/**
 * Classify a call that produced no two-way conversation.
 *
 * Order matters — the rules run from "we have hard evidence of a system fault"
 * down to "the homeowner genuinely didn't pick up", and only the LAST rule may
 * return no_answer. That inversion is the whole point: no_answer is now a
 * conclusion we have to earn, not the default we fall back to.
 */
export function classifyNonConversation(input: {
  terminationReason?: string;
  status?: string;
  durationSec?: number;
  /** ElevenLabs `metadata.error.code`, when present. */
  errorCode?: string | null;
  /** ElevenLabs `metadata.error.reason` — where the quota message actually lives. */
  errorReason?: string | null;
  /** Did the homeowner utter anything at all? */
  hasHumanTurn?: boolean;
  /**
   * Independent evidence THIS specific answered-but-silent call was a voicemail
   * — the agent delivered its scripted voicemail-drop message with no reply, or
   * carrier/Twilio machine detection confirmed it. Stronger and more specific
   * than the generic "nobody spoke" catch-all below, which stays reserved for
   * the genuinely ambiguous case (no signal either way).
   */
  voicemailSignal?: boolean;
  /** Set by callers that already KNOW the call never went out (e.g. a rejected dial). */
  failureKind?: FailureKind | null;
}): NonConversation {
  const reason = input.terminationReason ?? input.status ?? "";
  const duration = Math.max(0, Math.round(input.durationSec ?? 0));
  const answered = duration > 0;
  // The quota message can surface in any of these, depending on which path saw it.
  const providerMsg = `${input.errorReason ?? ""} ${input.errorCode ?? ""} ${reason}`;

  const fail = (failureKind: FailureKind): NonConversation => ({
    kind: "failure",
    failureKind,
    summary: FAILURE_SUMMARY[failureKind],
  });
  const filed = (outcome: CallOutcome): NonConversation => ({
    kind: "outcome",
    outcome,
    summary: OUTCOME_SUMMARY[outcome] ?? "Call did not connect — auto-categorized.",
  });

  // 0. The caller already knows this was a system fault (never dialed, etc.).
  if (input.failureKind) return fail(input.failureKind);

  // 1. OUT OF CREDITS. Checked FIRST, ahead of every other error, because it is
  //    both the most common cause of a dead call and the only one with a one-click
  //    fix — and because it is silently expensive: every one of these burned a
  //    real lead. Don't let it hide inside a generic "provider_error".
  if (isQuotaMessage(providerMsg)) return fail("provider_quota_exceeded");

  // 2. The provider told us outright that it errored.
  if (input.errorCode) return fail("provider_error");

  // 3. ANSWERED, then died almost immediately, with nothing said. A homeowner
  //    cannot produce this; only a broken agent can.
  if (answered && duration < KILL_ON_CONNECT_MAX_SEC && !input.hasHumanTurn) {
    return fail("agent_terminated_on_connect");
  }

  // 3.5. Independent, specific evidence this was voicemail — the agent left its
  //      message, or AMD confirmed a machine. This is a real homeowner outcome
  //      (the call reached them, just not live), so it's filed and excluded from
  //      "connected" like every other non-conversation outcome — never left to
  //      rot as an ambiguous system-fault requiring manual review.
  if (answered && !input.hasHumanTurn && input.voicemailSignal) {
    return filed("voicemail");
  }

  // 4. A dead/invalid number is a fact about the number — check before voicemail,
  //    since a disconnected-number recording can also look "machine"-ish.
  if (DEAD_NUMBER_RE.test(reason)) return filed("wrong_number");

  // 5. The provider explicitly said voicemail.
  if (VOICEMAIL_RE.test(reason)) return filed("voicemail");

  // 6. Answered, stayed up, but nobody ever spoke. Almost certainly voicemail we
  //    couldn't detect (AMD is off) — but it is NOT a no-answer, and saying so out
  //    loud is what surfaces the missing AMD instead of burying it. (The 25-second
  //    "no answer" in the incident data was this.)
  if (answered && !input.hasHumanTurn) return fail("answered_no_human_turn");

  // 7. Genuinely never answered: zero duration, or the provider said so.
  if (!answered || NO_ANSWER_RE.test(reason)) return filed("no_answer");

  // 8. Answered, a human spoke, but we were still asked to classify it as a
  //    non-conversation — the transcript never reached us. Don't guess.
  return fail("unresolvable");
}

/** A human-readable note explaining an auto-filed disposition. */
export function dispositionBlurb(outcome: CallOutcome): string {
  return OUTCOME_SUMMARY[outcome] ?? "Call did not connect — auto-categorized by AI.";
}

/** A human-readable note explaining an auto-filed system failure. */
export function failureBlurb(kind: FailureKind): string {
  return FAILURE_SUMMARY[kind];
}

/** Failures that mean the homeowner's phone never rang — the lead is still un-contacted. */
const NEVER_REACHED: ReadonlySet<FailureKind> = new Set<FailureKind>([
  "bridge_dial_failed",
  "not_placed",
]);

/** Was the homeowner never actually dialed? Such leads must stay due for a first attempt. */
export function neverReachedHomeowner(kind: FailureKind): boolean {
  return NEVER_REACHED.has(kind);
}
