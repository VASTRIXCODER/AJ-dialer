// ─────────────────────────────────────────────────────────────────────────────
// The realtime event contract — PURE and isomorphic (imported by the server
// publisher, the browser channel hook, and tests alike; no I/O, no env reads).
//
// One private broadcast channel per org (topic `org:<uuid>:floor`) carries
// every live-floor signal: call lifecycle, the answered fast-path, streaming
// transcript segments, leaderboard invalidations, and review-queue arrivals.
// The SERVER is the only publisher (service role, via publish.ts); clients can
// only receive broadcasts and track presence — enforced by RLS on
// realtime.messages (schema.sql PART 35), so nothing here needs to defend
// against forged events, only against missed ones (hence seq + slow-poll
// fallbacks in every consumer).
// ─────────────────────────────────────────────────────────────────────────────

/** Every event name that may travel on an org's floor channel. */
export type FloorEvent =
  | "call.state"
  | "call.answered"
  | "transcript.segment"
  | "leaderboard.delta"
  | "review.created";

/**
 * The envelope stamped onto every payload by the publisher:
 * - `seq` is monotonic PER SERVER INSTANCE — it orders events from one
 *   publisher, it does not totally order the floor (serverless has many
 *   instances). Consumers treat it as a tie-breaker/staleness hint only.
 * - `at` is the publish time (ISO) — what the floor's "stale" detection reads.
 */
export interface FloorEnvelope {
  seq: number;
  at: string;
}

/**
 * A call moved. `state` uses the channel's own lifecycle words rather than the
 * full canonical AttemptState set (docs/phase-1/call-state-machine.md): the
 * floor only needs to know what a card should LOOK like right now, and every
 * consumer refetches its snapshot endpoint on receipt — the event is a doorbell
 * carrying enough context to be rendered optimistically, not a ledger entry.
 */
export type FloorCallState = "calling" | "ringing" | "connected" | "ended";

export interface CallStatePayload extends FloorEnvelope {
  kind: "human" | "ai";
  /** humanId (manual conference) or conversationId (AI). */
  id: string;
  ownerId?: string | null;
  leadId?: string | null;
  leadName?: string;
  campaignId?: string | null;
  state: FloorCallState;
  /** ISO — when the call entered `state` (best-effort; may equal `at`). */
  stateSince?: string;
  /** Why an "ended" call ended (no-answer | busy | completed | …). */
  terminationReason?: string | null;
}

/** The answered fast-path for the manual dialer (room = `hc-<humanId>`). */
export interface AnsweredPayload extends FloorEnvelope {
  humanId: string;
  room: string;
  answeredLeadId: string | null;
}

/** One transcript turn, streamed as it lands (F1 fills these). */
export interface TranscriptSegmentPayload extends FloorEnvelope {
  conversationId: string;
  turnIndex: number;
  role: string;
  message: string;
  secs: number | null;
  /** False while the provider may still revise this turn. */
  final: boolean;
}

/** "Someone's numbers changed" — consumers refetch, the event carries no math. */
export interface LeaderboardDeltaPayload extends FloorEnvelope {
  ownerId: string | null;
}

/** A call landed in the needs-review queue (F1 publishes these). */
export interface ReviewCreatedPayload extends FloorEnvelope {
  reviewId?: string;
  conversationId?: string | null;
  callRecordId?: string | null;
  reason?: string;
}

/** Event name → payload shape, so publish/subscribe stay typed end to end. */
export interface FloorEventPayloadMap {
  "call.state": CallStatePayload;
  "call.answered": AnsweredPayload;
  "transcript.segment": TranscriptSegmentPayload;
  "leaderboard.delta": LeaderboardDeltaPayload;
  "review.created": ReviewCreatedPayload;
}

/**
 * Self-reported presence a client may `track` on the channel (the dialer joins
 * in E3). Distinct from the webhook-driven call state on purpose: presence is
 * what a browser CLAIMS, calls are what Twilio PROVED — and floor-merge.ts
 * always lets the proof win.
 */
export interface PresencePayload {
  userId: string;
  name: string;
  status: "available" | "paused" | "wrapup" | "dialing" | "ai";
  /** ms epoch — when the status last changed (drives the roster timer). */
  statusSince: number;
  /** Optional dialing mode detail ("manual" | "parallel" | "ai" …). */
  mode?: string;
}

// ── Topic naming ─────────────────────────────────────────────────────────────

/**
 * LOCKSTEP with public.app_can_join_org_topic (supabase/schema.sql PART 35):
 *   '^org:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:floor$'
 * If either side changes shape, the other MUST change with it — a topic this
 * accepts that SQL rejects can never be joined, and vice versa a topic SQL
 * accepts that this rejects would be published to but never validated here.
 */
const FLOOR_TOPIC_RE =
  /^org:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:floor$/;

/** The one true topic builder. Lowercases the UUID to match the SQL regex. */
export function orgFloorTopic(orgId: string): string {
  return `org:${orgId.toLowerCase()}:floor`;
}

export function isValidFloorTopic(topic: string): boolean {
  return FLOOR_TOPIC_RE.test(topic);
}

/**
 * Stamp the publisher envelope onto a payload. Pure so the publisher's one
 * interesting behavior (seq/at stamping) is testable without any HTTP.
 */
export function stampEnvelope<E extends FloorEvent>(
  payload: Omit<FloorEventPayloadMap[E], keyof FloorEnvelope>,
  seq: number,
  at: Date = new Date(),
): FloorEventPayloadMap[E] {
  return { ...payload, seq, at: at.toISOString() } as FloorEventPayloadMap[E];
}
