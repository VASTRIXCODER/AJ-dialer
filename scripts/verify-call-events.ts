/**
 * Call-event verification — `npm run verify:call-events`.
 *
 * Guards the invariant behind the reported bug: "I press Start session, it
 * rings, and then it boots me out back to Start session."
 *
 * The rep's browser leg and the homeowner's leg are placed by two different
 * mechanisms — the homeowner by REST with inline TwiML, the rep through the
 * TwiML App — so the homeowner's phone can ring perfectly while the rep's side
 * dies instantly. What made that unreadable rather than merely unlucky was the
 * event handling: Twilio Calls keep emitting after they end, the handlers were
 * attached per Call and never scoped to one, and a trailing event from a dead
 * call reset a UI that had already moved on. Silently.
 *
 * Every check below runs the REAL decision function the dialer ships
 * (src/lib/dialer/call-events.ts) against the OLD behaviour it replaced, so a
 * regression here fails the run rather than reaching a rep.
 */
import {
  type CallEvent,
  type CallEventContext,
  decideCallEvent,
  describeCallError,
  DROPPED_BEFORE_ANSWER,
} from "@/lib/dialer/call-events";

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31mFAIL  ${m}\x1b[0m`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : bad(m));

// ─────────────────────────────────────────────────────────────────────────────
// The OLD handlers, transcribed from the code this replaced. Kept so each check
// can show the bug actually existed — a test that passes against both versions
// is proving nothing.
//
//   call.on("disconnect", () => endCall());              // → wrapup, callRef = null
//   call.on("cancel",     () => resetToIdle());          // → idle, no message
//   call.on("reject",     () => resetToIdle());          // → idle, no message
//   call.on("error",      () => {
//     if (callRef.current && callRef.current.status() !== "closed") return;
//     resetToIdle();                                     // → idle, no message
//   });
// ─────────────────────────────────────────────────────────────────────────────
type OldAction = { type: "ignore" } | { type: "wrapup" } | { type: "idle"; reason: string | null };

function oldDecideCallEvent(
  event: CallEvent,
  ctx: CallEventContext & { callRefIsNull: boolean; callRefStatus: string },
): OldAction {
  switch (event) {
    case "disconnect":
      return { type: "wrapup" };
    case "cancel":
    case "reject":
      return { type: "idle", reason: null }; // reset in total silence
    case "error":
      // NOTE: the old guard read callRef.current — the dialer's CURRENT call —
      // not the call that emitted the event. Null (already wrapped up or idle)
      // fell straight through to the reset.
      if (!ctx.callRefIsNull && ctx.callRefStatus !== "closed") return { type: "ignore" };
      return { type: "idle", reason: null };
  }
}

const ctx = (over: Partial<CallEventContext> = {}): CallEventContext => ({
  isCurrent: true,
  bridged: false,
  intentional: false,
  callStatus: "closed",
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The reported bug: a trailing event from a dead call must not reset the UI.
// ─────────────────────────────────────────────────────────────────────────────
function checkTrailingEvents() {
  console.log("\n1. A finished call's late events have no authority");

  // The exact reported sequence. The rep's leg dies mid-ring; `disconnect` is
  // handled; then Twilio's trailing media error arrives a beat later.
  const trailing = decideCallEvent("error", ctx({ isCurrent: false }));
  const trailingOld = oldDecideCallEvent(
    "error",
    { ...ctx({ isCurrent: false }), callRefIsNull: true, callRefStatus: "closed" },
  );
  check(
    trailing.type === "ignore",
    "a trailing error from a call the dialer has moved on from is ignored",
  );
  check(
    trailingOld.type === "idle" && trailingOld.reason === null,
    "the old code genuinely reset to Start on that same event, with no message (proving this test is meaningful)",
  );

  // The same trailing error, arriving while the rep is on a DIFFERENT live call.
  // The old `cancel`/`reject` handlers didn't even check — they reset outright,
  // hanging up a rep mid-conversation.
  check(
    decideCallEvent("cancel", ctx({ isCurrent: false, bridged: true })).type === "ignore",
    "a stale cancel cannot drop the rep out of a live call they're on now",
  );
  check(
    oldDecideCallEvent("cancel", {
      ...ctx({ isCurrent: false, bridged: true }),
      callRefIsNull: false,
      callRefStatus: "open",
    }).type === "idle",
    "the old cancel handler genuinely dropped a live call (proving this test is meaningful)",
  );

  // Wrap-up must survive too: a trailing error during disposition used to wipe
  // the outcome screen before the rep could score the call.
  check(
    decideCallEvent("error", ctx({ isCurrent: false, bridged: true })).type === "ignore",
    "a trailing error during wrap-up leaves the disposition screen standing",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. A dial that never connected is a failure, not something to disposition.
// ─────────────────────────────────────────────────────────────────────────────
function checkFailedDial() {
  console.log("\n2. A leg dropped before pickup reads as a failed dial");

  const dropped = decideCallEvent("disconnect", ctx({ bridged: false, intentional: false }));
  check(
    dropped.type === "idle" && dropped.reason === DROPPED_BEFORE_ANSWER,
    "the rep's leg dying mid-ring returns to idle WITH a reason (releasing the outbound leg)",
  );
  check(
    typeof dropped.type === "string" &&
      dropped.type === "idle" &&
      (dropped.reason ?? "").includes("TwiML App"),
    "…and the reason names the TwiML App Voice URL — the usual root cause",
  );
  check(
    oldDecideCallEvent("disconnect", {
      ...ctx(),
      callRefIsNull: false,
      callRefStatus: "closed",
    }).type === "wrapup",
    "the old code sent the rep to a disposition form for a call that never happened (proving this test is meaningful)",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Real calls still reach wrap-up. The fix must not eat dispositions.
// ─────────────────────────────────────────────────────────────────────────────
function checkRealCallsStillWrapUp() {
  console.log("\n3. Calls that actually happened still reach disposition");

  check(
    decideCallEvent("disconnect", ctx({ bridged: true })).type === "wrapup",
    "a homeowner hanging up after a real conversation goes to wrap-up",
  );
  check(
    decideCallEvent("disconnect", ctx({ intentional: true })).type === "wrapup",
    "a no-answer (we hang the rep's leg up) goes to wrap-up, so it can be scored",
  );
  check(
    decideCallEvent("disconnect", ctx({ intentional: true, bridged: true })).type === "wrapup",
    "the rep pressing End call goes to wrap-up",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. A recoverable error must never abandon a call the customer is still on.
// ─────────────────────────────────────────────────────────────────────────────
function checkRecoverableErrors() {
  console.log("\n4. A recoverable error does not cut a live call off");

  check(
    decideCallEvent("error", ctx({ bridged: true, callStatus: "open" })).type === "ignore",
    "an error on a still-open call is left to disconnect to decide",
  );
  check(
    decideCallEvent("error", ctx({ bridged: true, callStatus: "reconnecting" })).type === "ignore",
    "an error while the SDK is mid-reconnect is not a teardown",
  );
  const fatal = decideCallEvent("error", ctx({ callStatus: "closed" }));
  check(
    fatal.type === "idle" && fatal.reason === null,
    "an error on a genuinely closed call resets — and defers to the Twilio error for the message",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Every exit tells the rep something. Silence was the actual bug.
// ─────────────────────────────────────────────────────────────────────────────
function checkNothingIsSilent() {
  console.log("\n5. No exit is silent");

  const events: CallEvent[] = ["disconnect", "cancel", "reject", "error"];
  for (const event of events) {
    const action = decideCallEvent(event, ctx());
    if (action.type !== "idle") continue;
    // `null` is not silence — it means "use describeCallError", which always
    // returns a sentence, even for an error object carrying nothing at all.
    const message = action.reason ?? describeCallError(null);
    check(message.trim().length > 0, `\`${event}\` → idle always carries a message`);
  }

  check(
    describeCallError({ code: 31401 }).includes("microphone"),
    "a blocked microphone (31401) is named as a microphone problem",
  );
  check(
    describeCallError({ code: 31005 }).includes("connection"),
    "a signalling failure (31005) is named as a connection problem",
  );
  check(
    describeCallError({ code: 99999, message: "boom" }).includes("99999"),
    "an unrecognised code is still reported verbatim rather than swallowed",
  );
  check(
    describeCallError(undefined).trim().length > 0,
    "even a completely empty error produces a sentence",
  );
}

checkTrailingEvents();
checkFailedDial();
checkRealCallsStillWrapUp();
checkRecoverableErrors();
checkNothingIsSilent();

console.log(
  failures === 0
    ? "\n\x1b[32mAll checks passed.\x1b[0m"
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m`,
);
process.exit(failures === 0 ? 0 : 1);
