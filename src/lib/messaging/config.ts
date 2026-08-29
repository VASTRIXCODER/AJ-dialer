// ─────────────────────────────────────────────────────────────────────────────
// "Is messaging wired up?" — and nothing else.
//
// This is a separate module for one structural reason: the send gate and the
// orchestration engine both need to ASK the question, and neither may be able
// to reach the answer's neighbour. `transport.ts` holds sendMessage, so
// anything importing it can, in principle, send — and the whole design rests on
// the engine being unable to. Splitting the question from the capability means
// the boundary is enforced by the import graph rather than by everyone
// remembering, and tests/messaging-architecture.test.ts checks it holds.
//
// This is also deliberately DERIVED, never a feature flag. An org must not be
// able to switch on a channel that isn't connected, because the switch would
// then be a promise the product cannot keep.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enough configured to send a message.
 *
 * Note what is NOT required: a caller ID. A conversation replies from the
 * number it was started on, which lives on the thread — borrowing the voice
 * pool's rotating number would scatter one conversation across eleven numbers.
 */
export function isMessagingConfigured(): boolean {
  return Boolean(
    (process.env.TWILIO_ACCOUNT_SID ?? "") && (process.env.TWILIO_AUTH_TOKEN ?? ""),
  );
}

/** Simulation never reaches Twilio, so it is safe with real credentials set. */
export function isMessagingSimulated(): boolean {
  return process.env.MESSAGING_SIMULATION === "true";
}
