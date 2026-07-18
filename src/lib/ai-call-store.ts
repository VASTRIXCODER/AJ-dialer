import "server-only";

import { type AILiveState, LIVE_STATES, type CallOutcome } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Live registry of AI (ElevenLabs) conversations.
//
// Populated when a call is placed, marked active by the personalization webhook,
// and completed by the post-call webhook (with Claude-derived results). Powers
// the Live Monitor and AI Agent page.
//
// Module-level state — correct for a single long-running instance. On serverless
// (Vercel) instances don't share memory, so back this with Redis / a DB / Twilio
// Sync for production; the exported functions are the seam to swap. See the
// setup guide.
// ─────────────────────────────────────────────────────────────────────────────

/** The canonical lifecycle lives in types.ts — this is the shared vocabulary. */
export type AICallState = AILiveState;

export interface AICall {
  conversationId: string;
  callSid: string | null;
  leadId: string | null;
  /** The organization this call was placed for — set at registration when known. */
  orgId?: string | null;
  leadName: string;
  phone: string;
  city: string;
  state: AICallState;
  sentiment: "positive" | "neutral" | "negative";
  startedAt: number;
  /** Their phone started ringing. */
  ringingAt?: number;
  /** They picked up. The on-call timer counts from here — never from startedAt. */
  connectedAt?: number;
  endedAt?: number;
  durationSec?: number;
  summary?: string;
  /** null when the call failed for a SYSTEM reason and has no homeowner outcome. */
  outcome?: CallOutcome | null;
  recordingAvailable?: boolean;
  appointment?: { when: string; notes: string } | null;
  /** Active Twilio Media Stream SID while a supervisor is listening live. */
  streamSid?: string;
  /** Conference room (bridge mode) — listeners join this muted. */
  room?: string;
  /** The homeowner's Twilio leg (bridge mode), for transfer/end control. */
  customerCallSid?: string;
}

const calls = new Map<string, AICall>();
const bySid = new Map<string, string>(); // callSid → conversationId
const TTL_MS = 60 * 60_000;
/**
 * A call cannot genuinely still be on the phone after this. Past it, an entry
 * that never got an endedAt is not "live", it's LEAKED — see sweep().
 */
const MAX_ACTIVE_MS = 12 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [id, c] of calls) {
    // Ended long ago — ordinary expiry.
    const expired = c.endedAt != null && now - c.endedAt > TTL_MS;
    // Never ended, and far too old to still be ringing or talking. This branch
    // is the fix for a genuine leak: the old sweep required `endedAt` to be set,
    // so an entry stuck in initiated/ringing/in_progress could NEVER be evicted.
    // It stayed in this Map for the life of the instance, listActiveAICalls()
    // kept returning it, and the monitor kept showing a call that had been over
    // for hours — one that no refresh could clear, because the stale entry
    // outranked the (correct, terminal) database row on every poll.
    const leaked = c.endedAt == null && now - c.startedAt > MAX_ACTIVE_MS;
    if (expired || leaked) {
      calls.delete(id);
      if (c.callSid) bySid.delete(c.callSid);
    }
  }
}

export function registerAICall(input: {
  conversationId: string;
  callSid: string | null;
  leadId: string | null;
  orgId?: string | null;
  leadName: string;
  phone: string;
  city?: string;
  room?: string;
  customerCallSid?: string;
}): AICall {
  sweep();
  const call: AICall = {
    conversationId: input.conversationId,
    callSid: input.callSid,
    leadId: input.leadId,
    orgId: input.orgId ?? null,
    leadName: input.leadName,
    phone: input.phone,
    city: input.city ?? "",
    state: "initiated",
    sentiment: "neutral",
    startedAt: Date.now(),
    room: input.room,
    customerCallSid: input.customerCallSid,
  };
  calls.set(call.conversationId, call);
  if (call.callSid) bySid.set(call.callSid, call.conversationId);
  return call;
}

export function updateAICall(
  conversationId: string,
  patch: Partial<AICall>,
): AICall | null {
  const existing = calls.get(conversationId);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  calls.set(conversationId, merged);
  if (merged.callSid && !bySid.has(merged.callSid)) {
    bySid.set(merged.callSid, conversationId);
  }
  return merged;
}

export function findByCallSid(callSid: string): AICall | null {
  const id = bySid.get(callSid);
  return id ? (calls.get(id) ?? null) : null;
}

export function getAICall(conversationId: string): AICall | null {
  return calls.get(conversationId) ?? null;
}

/**
 * `orgId` is required so two orgs never see each other's live calls just
 * because their requests happen to land on the same warm serverless instance
 * (this Map is process-wide, not per-tenant). A call registered before its
 * `orgId` was known (should not happen in practice, but defensively) is
 * excluded rather than shown to everyone.
 */
export function listActiveAICalls(orgId: string): AICall[] {
  sweep(); // evict leaked entries on READ too — registerAICall may never run again
  return [...calls.values()]
    .filter((c) => c.orgId === orgId && LIVE_STATES.includes(c.state))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function listRecentAICalls(orgId: string, limit = 8): AICall[] {
  return [...calls.values()]
    .filter(
      (c) => c.orgId === orgId && (c.state === "completed" || c.state === "failed"),
    )
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, limit);
}
