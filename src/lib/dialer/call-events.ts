// Pure decision logic for the Twilio Voice SDK's Call events, shared by
// use-dialer and its verification script (`npm run verify:call-events`).
//
// This exists because getting it wrong is invisible from the rep's chair and
// devastating in production. A Twilio Call keeps emitting AFTER it is over —
// trailing media/ICE errors follow a hang-up, and `cancel` lands on an outgoing
// leg Twilio gave up on. The dialer attaches handlers per Call and never
// detaches them, so without an explicit "is this still the call I'm on?" test,
// events from a DEAD call run against whatever the dialer is doing seconds later.
// That is what produced the two worst-reported dialer bugs:
//
//   • press Start → the homeowner's phone rings → the screen snaps back to
//     "Start session" with nothing said (a trailing error after the rep's leg
//     died reset a UI that had already moved on), and
//   • finish a real conversation → the disposition screen vanishes before the
//     rep can score it (same trailing error, arriving during wrap-up).
//
// Keeping the decision here — pure, and separate from the hook's refs and
// setState — is what lets those two scenarios be asserted rather than hoped for.

/** The Call events the dialer reacts to. */
export type CallEvent = "disconnect" | "cancel" | "reject" | "error";

export interface CallEventContext {
  /** Is the call that emitted this event still the dialer's ACTIVE call? */
  isCurrent: boolean;
  /** Was a homeowner actually bridged to the rep on this attempt? */
  bridged: boolean;
  /** Did WE hang this leg up (End call, no-answer, timeout, Cancel)? */
  intentional: boolean;
  /** The EMITTING call's own status, per the Voice SDK ("open" | "closed" | …). */
  callStatus: string;
}

export type CallEventAction =
  /** Do nothing — this event has no authority over the dialer's current state. */
  | { type: "ignore"; why: string }
  /** Go to wrap-up so the rep can disposition what just happened. */
  | { type: "wrapup" }
  /**
   * Go back to idle and release any outbound leg. `reason` is what the rep is
   * told; `null` means "describe the Twilio error that came with the event"
   * (see describeCallError) — never means "say nothing."
   */
  | { type: "idle"; reason: string | null };

/**
 * What a dropped leg means when nobody ever answered.
 *
 * The rep's browser leg is the ONLY one that goes through the TwiML App; the
 * homeowner's leg is placed by REST with inline TwiML. So a misconfigured TwiML
 * App Voice URL fails the rep's side while the homeowner's phone rings normally
 * — which is precisely the "it rings and then it boots me out" report. Name that
 * cause, because it's both the most common one and the one a rep would never
 * guess. `/api/twilio/voice` (GET) reads the configured URL back for comparison.
 */
export const DROPPED_BEFORE_ANSWER =
  "Your side of the call dropped before the homeowner picked up — the line was hung up. If this keeps happening, check that your Twilio TwiML App's Voice URL points at this app.";

export function decideCallEvent(
  event: CallEvent,
  ctx: CallEventContext,
): CallEventAction {
  // Rule one, and the whole point of this module: a call that is no longer the
  // active call gets no say. It may have been superseded by a newer dial, or the
  // dialer may already have moved on to wrap-up or idle.
  if (!ctx.isCurrent) {
    return { type: "ignore", why: "event from a call that is no longer active" };
  }

  switch (event) {
    case "disconnect":
      // Ours (End call / no-answer / timeout), or a real conversation the
      // homeowner hung up — either way there's something to disposition.
      if (ctx.intentional || ctx.bridged) return { type: "wrapup" };
      // Otherwise Twilio dropped the REP's leg while the homeowner was still
      // ringing. That's a failed dial, not a call: sending the rep to a wrap-up
      // form for a conversation that never happened teaches them to distrust the
      // screen, and leaves a homeowner ringing a conference nobody will join.
      return { type: "idle", reason: DROPPED_BEFORE_ANSWER };

    case "cancel":
      return {
        type: "idle",
        reason: "The call ended before it could connect you. Press Start to try again.",
      };

    case "reject":
      return {
        type: "idle",
        reason: "Twilio rejected your side of the call. Press Start to try again.",
      };

    case "error":
      // The SDK fires `error` for plenty of non-fatal conditions. If the call is
      // still open the rep may well still be talking — tearing down here is the
      // "the call just cut off mid-sentence" bug. Let `disconnect` decide.
      if (ctx.callStatus !== "closed") {
        return { type: "ignore", why: "the call is still open — disconnect will decide" };
      }
      return { type: "idle", reason: null };
  }
}

/**
 * Turn a Twilio Voice SDK call failure into something a rep can act on.
 *
 * The SDK hands the `error` event a real TwilioError carrying a numeric code —
 * and the handler used to take no argument at all, so every one of these was
 * discarded and the rep was dropped back to the Start screen with nothing on it.
 * From the outside that is indistinguishable from the button doing nothing,
 * which is exactly how it was reported.
 *
 * Codes: https://www.twilio.com/docs/api/errors — 314xx are client media,
 * 31005/53xxx are signalling/transport.
 */
export function describeCallError(err: unknown): string {
  const e = (err ?? null) as {
    code?: unknown;
    message?: unknown;
    description?: unknown;
    causes?: unknown;
  } | null;
  const code = typeof e?.code === "number" ? e.code : null;

  switch (code) {
    case 31401:
    case 31208:
      return "Your microphone is blocked for this site. Allow microphone access in your browser, then press Start again.";
    case 31402:
      return "Couldn't open your microphone — another app may be holding it. Close it (or pick a different input) and try again.";
    case 31400:
      return "No microphone was found. Plug one in or select an input device, then try again.";
    case 31005:
    case 53000:
    case 53001:
    case 53405:
      return "Lost the connection to Twilio while joining the call. Check your network, then press Start again.";
    case 31009:
      return "Your network is blocking the call's media. If you're on a corporate VPN or firewall, that's the usual cause.";
    default:
      break;
  }

  const detail =
    (typeof e?.description === "string" && e.description) ||
    (typeof e?.message === "string" && e.message) ||
    "";
  return code
    ? `Couldn't connect your side of the call — Twilio error ${code}${detail ? `: ${detail}` : ""}.`
    : `Couldn't connect your side of the call${detail ? ` — ${detail}` : ""}.`;
}
