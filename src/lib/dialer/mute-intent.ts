// ─────────────────────────────────────────────────────────────────────────────
// Pre-answer mute — the pure decision core (E3).
//
// On a manual dial the rep's browser leg joins the Twilio conference the moment
// `device.connect()` resolves, which is BEFORE the customer answers. So mute is
// genuinely available from "Dialing…" onward — except for a sub-second window
// between pressing Start and connect() resolving, where there is no Call object
// to mute yet. A toggle pressed in that window must not be dropped (the rep hit
// the button; the UI shows muted) and must not throw — it is QUEUED as an
// intent, and attachCallHandlers applies it the instant the Call exists.
//
// Kept pure (no refs, no Twilio) so the three-way decision — apply now, queue
// for the arming window, or ignore because nothing is in flight — is unit-
// testable, and the hook just carries the verdict out.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the mute control can honestly do right now:
 *  - "ready": a live Call exists — mute takes effect immediately.
 *  - "arming": a dial is in flight but connect() hasn't resolved — a toggle is
 *    queued and applied the moment the rep leg exists.
 *  - "unsupported": no way to mute in this configuration (demo mode / Twilio
 *    absent / AI mode, where the rep has no leg at all).
 */
export type MuteCapability = "ready" | "arming" | "unsupported";

export type MuteToggleDecision =
  | { action: "apply"; muted: boolean }
  | { action: "queue"; muted: boolean }
  | { action: "ignore" };

/**
 * Decide what a mute-button press does. `hasCall` wins over `dialInFlight`
 * (once the Call exists it is always the real target); with neither, there is
 * nothing to mute and the press changes nothing — no optimistic "muted" pill
 * over a capability that doesn't exist.
 */
export function decideMuteToggle(input: {
  muted: boolean;
  hasCall: boolean;
  dialInFlight: boolean;
}): MuteToggleDecision {
  const next = !input.muted;
  if (input.hasCall) return { action: "apply", muted: next };
  if (input.dialInFlight) return { action: "queue", muted: next };
  return { action: "ignore" };
}

/** Derive the capability the UI should advertise for the current attempt. */
export function resolveMuteCapability(input: {
  /** The Twilio device is registered and usable for manual calls. */
  twilioLive: boolean;
  /** AI mode — the agent dials server-side; the rep has no leg to mute. */
  aiMode: boolean;
  hasCall: boolean;
  dialInFlight: boolean;
}): MuteCapability {
  if (input.aiMode || !input.twilioLive) return "unsupported";
  if (input.hasCall) return "ready";
  if (input.dialInFlight) return "arming";
  return "unsupported";
}
