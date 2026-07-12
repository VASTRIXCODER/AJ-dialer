// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker for AI dialing.
//
// (Deliberately free of server-only / DB imports: this is plain in-memory state,
// and the trip rules are the thing standing between a billing lapse and 1,500
// burned leads — so they must be directly testable. See scripts/verify-disposition.ts.)
//
// THE FAILURE THIS EXISTS TO PREVENT
// The ElevenLabs credit balance ran out. Outbound calls kept getting placed —
// Twilio dialed, homeowners answered, the agent began a greeting, and the
// provider killed each call after ~2 seconds ("This request exceeds your quota
// limit", 0 credits charged). The dialer had no idea anything was wrong, so it
// kept going: 1,500 real homeowners were called, heard half a sentence, and hung
// up. Every one was filed as "no answer" and marked contacted.
//
// The lesson is not "check the balance" (we now do, in fetchQuota). It is that a
// bulk dialer must NOTICE when every call it places is dying the same way, and
// STOP ON ITS OWN. A lead you didn't call can be called tomorrow. A lead you
// called with a broken agent is spent — you cannot un-ring their phone.
//
// So: N consecutive provider-side failures with no successful conversation in
// between trips the breaker, and AI dialing refuses to start until the operator
// resets it (or it times out and allows a single probe through).
// ─────────────────────────────────────────────────────────────────────────────

/** Consecutive provider failures before we stop dialing. */
const TRIP_THRESHOLD = 5;
/** After this long, allow ONE probe call through to see if the problem is fixed. */
const HALF_OPEN_AFTER_MS = 10 * 60_000;

export type BreakerReason = "provider_quota_exceeded" | "agent_terminated_on_connect" | "provider_error";

interface BreakerState {
  consecutiveFailures: number;
  trippedAt: number | null;
  reason: BreakerReason | null;
  lastMessage: string;
}

// Module-level: per serverless instance. Not perfect across instances, but a
// batch is driven from one client through a warm instance, which is exactly the
// runaway case this must catch. The durable backstop is the preflight quota check.
const state: BreakerState = {
  consecutiveFailures: 0,
  trippedAt: null,
  reason: null,
  lastMessage: "",
};

export interface BreakerStatus {
  open: boolean;
  reason: BreakerReason | null;
  message: string;
  consecutiveFailures: number;
  trippedAt: number | null;
  /** True when the cool-off has elapsed and one probe call is allowed through. */
  halfOpen: boolean;
}

export function breakerStatus(): BreakerStatus {
  const halfOpen =
    state.trippedAt !== null && Date.now() - state.trippedAt > HALF_OPEN_AFTER_MS;
  return {
    open: state.trippedAt !== null && !halfOpen,
    halfOpen,
    reason: state.reason,
    message: state.lastMessage,
    consecutiveFailures: state.consecutiveFailures,
    trippedAt: state.trippedAt,
  };
}

/** A call produced a real conversation — the provider is healthy. Reset. */
export function recordCallSuccess(): void {
  state.consecutiveFailures = 0;
  state.trippedAt = null;
  state.reason = null;
  state.lastMessage = "";
}

/** A call died on the provider's side. Trip the breaker once this keeps happening. */
export function recordProviderFailure(reason: BreakerReason, message = ""): BreakerStatus {
  state.consecutiveFailures++;
  state.lastMessage = message;
  state.reason = reason;

  // Out of credits is not a flake — every subsequent call WILL die the same way,
  // and each one burns a lead. Don't wait for five of them.
  const threshold = reason === "provider_quota_exceeded" ? 1 : TRIP_THRESHOLD;

  if (state.consecutiveFailures >= threshold && state.trippedAt === null) {
    state.trippedAt = Date.now();
    console.error("[ai-breaker] TRIPPED — AI dialing halted", {
      reason,
      consecutiveFailures: state.consecutiveFailures,
      message,
    });
  }
  return breakerStatus();
}

/** Operator override — used by the admin "resume AI dialing" action. */
export function resetBreaker(): void {
  recordCallSuccess();
  console.log("[ai-breaker] manually reset");
}

/** A probe is going out while half-open; if it fails we re-trip immediately. */
export function armProbe(): void {
  state.trippedAt = null;
  state.consecutiveFailures = TRIP_THRESHOLD - 1;
}
