import "server-only";

import type { CallOutcome } from "./types";

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

export type AICallState = "initiated" | "in_progress" | "completed" | "failed";

export interface AICall {
  conversationId: string;
  callSid: string | null;
  leadId: string | null;
  leadName: string;
  phone: string;
  city: string;
  state: AICallState;
  sentiment: "positive" | "neutral" | "negative";
  startedAt: number;
  endedAt?: number;
  durationSec?: number;
  summary?: string;
  outcome?: CallOutcome;
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

function sweep() {
  const now = Date.now();
  for (const [id, c] of calls) {
    if (c.endedAt && now - c.endedAt > TTL_MS) {
      calls.delete(id);
      if (c.callSid) bySid.delete(c.callSid);
    }
  }
}

export function registerAICall(input: {
  conversationId: string;
  callSid: string | null;
  leadId: string | null;
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

export function listActiveAICalls(): AICall[] {
  return [...calls.values()]
    .filter((c) => c.state === "initiated" || c.state === "in_progress")
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function listRecentAICalls(limit = 8): AICall[] {
  return [...calls.values()]
    .filter((c) => c.state === "completed" || c.state === "failed")
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, limit);
}
