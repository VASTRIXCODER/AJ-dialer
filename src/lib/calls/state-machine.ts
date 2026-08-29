// ─────────────────────────────────────────────────────────────────────────────
// Canonical call-attempt state machine — PURE module (client- & server-safe).
//
// One explicit, validated vocabulary for every call attempt, replacing the four
// scattered ones (live_calls, ai_conversations, call_records, dialer UI). This
// module is only the TABLE + the decision logic: it never touches the DB. The
// single ingester (apply-event.ts) turns these decisions into CAS updates, so
// webhooks that arrive late, twice, or out of order can never corrupt a row.
// Spec: docs/phase-1/call-state-machine.md.
// ─────────────────────────────────────────────────────────────────────────────

export type AttemptState =
  | "queued"
  | "reserved"
  | "dialing"
  | "ringing"
  | "human_connected"
  | "voicemail_connected"
  | "busy"
  | "declined"
  | "no_answer"
  | "failed"
  | "canceled"
  | "wrap_up"
  | "dispositioned"
  | "completed";

// The canonical event vocabulary — every provider webhook, app action, and cron
// repair is translated into exactly one of these before it can move an attempt.
export type CallEventType =
  | "attempt.queued"
  | "reservation.claimed"
  | "reservation.released"
  | "reservation.expired"
  | "dial.requested"
  | "leg.initiated"
  | "leg.ringing"
  | "leg.answered"
  | "leg.machine_detected"
  | "leg.busy"
  | "leg.declined"
  | "leg.no_answer"
  | "leg.failed"
  | "leg.canceled"
  | "leg.completed"
  | "wrap.started"
  | "disposition.filed"
  | "attempt.completed"
  | "attempt.reconciled";

// Monotonic rank: an attempt only ever moves forward through these bands, so a
// late webhook for an earlier phase is recognizable as stale by comparison
// alone. Equal ranks are ALTERNATES (human vs machine answer; the five
// transport-terminal verdicts) — the first one written wins the CAS and the
// loser is stale, never an overwrite.
export const STATE_RANK: Record<AttemptState, number> = {
  queued: 0,
  reserved: 1,
  dialing: 2,
  ringing: 3,
  human_connected: 4,
  voicemail_connected: 4,
  busy: 5,
  declined: 5,
  no_answer: 5,
  failed: 5,
  canceled: 5,
  wrap_up: 6,
  dispositioned: 7,
  completed: 8,
};

// The full legal-edge table. Notes on the non-obvious edges:
// - reserved→queued is the reservation RELEASE (an app action, not a provider
//   event — it never flows through decideTransition, which would rank it stale).
// - dialing can jump straight to a verdict: Twilio compresses fast answers and
//   fast failures, so "ringing" is not guaranteed to arrive first.
// - human_connected→failed covers a bridge/transfer dying mid-call.
// - wrap_up is optional: terminal states may go straight to dispositioned or
//   completed (AI calls file their outcome without a rep wrap-up screen).
export const TRANSITIONS: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  queued: ["reserved", "dialing", "canceled"],
  reserved: ["dialing", "queued", "canceled"],
  dialing: [
    "ringing",
    "human_connected",
    "voicemail_connected",
    "busy",
    "declined",
    "no_answer",
    "failed",
    "canceled",
  ],
  ringing: [
    "human_connected",
    "voicemail_connected",
    "busy",
    "declined",
    "no_answer",
    "failed",
    "canceled",
  ],
  human_connected: ["wrap_up", "dispositioned", "completed", "failed"],
  voicemail_connected: ["wrap_up", "dispositioned", "completed"],
  busy: ["wrap_up", "dispositioned", "completed"],
  declined: ["wrap_up", "dispositioned", "completed"],
  no_answer: ["wrap_up", "dispositioned", "completed"],
  failed: ["wrap_up", "dispositioned", "completed"],
  canceled: ["wrap_up", "dispositioned", "completed"],
  wrap_up: ["dispositioned", "completed"],
  dispositioned: ["completed"],
  completed: [],
};

// States that carry the attempt's transport verdict. Once one of these is
// stamped, `transport_outcome` fills exactly once and nothing except the
// sanctioned reconciler upgrade (attempt.reconciled, outside this module) may
// change which verdict it was. Connected states count: an answer IS the
// transport outcome even though the attempt keeps moving toward completed.
export const TRANSPORT_TERMINAL: ReadonlySet<AttemptState> = new Set<AttemptState>([
  "busy",
  "declined",
  "no_answer",
  "failed",
  "canceled",
  "human_connected",
  "voicemail_connected",
]);

export function isTransportTerminal(state: AttemptState): boolean {
  return TRANSPORT_TERMINAL.has(state);
}

export function canTransition(from: AttemptState, to: AttemptState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionDecision {
  /** True only when the caller should attempt the CAS update. */
  apply: boolean;
  reason: "ok" | "duplicate" | "stale" | "invalid";
  /**
   * Every state a transition to `incoming` is legal FROM — verbatim the
   * `.in("state", allowedFrom)` guard list for the CAS update, so the SQL can
   * never accept an edge this table would reject.
   */
  allowedFrom: AttemptState[];
}

const ALL_STATES = Object.keys(STATE_RANK) as AttemptState[];

const legalSourcesOf = (incoming: AttemptState): AttemptState[] =>
  ALL_STATES.filter((s) => canTransition(s, incoming));

// The out-of-order guard for provider events. Ranks decide staleness BEFORE
// edges decide legality: a lower-or-equal-rank arrival is old news (equal rank
// means a sibling alternate lost the race — first CAS wins, upgrades happen
// only via the reconciler), and a higher-rank arrival without a legal edge is
// a protocol violation worth logging, not applying.
export function decideTransition(
  current: AttemptState,
  incoming: AttemptState,
): TransitionDecision {
  const allowedFrom = legalSourcesOf(incoming);
  if (current === incoming) {
    return { apply: false, reason: "duplicate", allowedFrom };
  }
  if (STATE_RANK[incoming] <= STATE_RANK[current]) {
    return { apply: false, reason: "stale", allowedFrom };
  }
  if (canTransition(current, incoming)) {
    return { apply: true, reason: "ok", allowedFrom };
  }
  return { apply: false, reason: "invalid", allowedFrom };
}

// Twilio's customer-leg status → attempt state. `completed` maps to null on
// purpose: a leg ending is not a verdict on the attempt (the verdict already
// arrived as answered/busy/etc., or the reconciler will supply one). AnsweredBy
// decides human vs machine — every AMD value starts with "machine".
export function twilioStatusToState(
  callStatus: string,
  answeredBy?: string | null,
): AttemptState | null {
  switch (callStatus) {
    case "initiated":
    case "queued":
      return "dialing";
    case "ringing":
      return "ringing";
    case "in-progress":
    case "answered":
      return answeredBy?.startsWith("machine") ? "voicemail_connected" : "human_connected";
    case "busy":
      return "busy";
    case "no-answer":
      return "no_answer";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "completed":
    default:
      return null;
  }
}

// Dedupe fingerprint for the `call_events (source, provider_event_id)` unique
// index — the FIRST line of idempotency, killing exact retries before any state
// logic runs. Twilio has no event id, but CallSid + CallStatus + SequenceNumber
// uniquely names a delivery; ElevenLabs sends a real event id. Null means "no
// safe fingerprint" — the caller must not fabricate one.
export function providerEventFingerprint(input: {
  source: "twilio" | "elevenlabs";
  sid?: string | null;
  status?: string | null;
  sequence?: string | null;
  eventId?: string | null;
}): string | null {
  if (input.source === "twilio") {
    if (!input.sid) return null;
    return `${input.sid}:${input.status ?? ""}:${input.sequence ?? ""}`;
  }
  return input.eventId ?? null;
}
