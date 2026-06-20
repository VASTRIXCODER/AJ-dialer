import "server-only";

import { getAICall, updateAICall } from "./ai-call-store";
import { analyzeConversation } from "./ai/services";
import { dispositionBlurb, unconnectedOutcome } from "./call-disposition";
import { getLeadById } from "./db/leads";
import { completeAIConversation } from "./db/records";
import type { CallOutcome, Lead } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for turning a finished ElevenLabs conversation into a
// disposition + summary and persisting it. Called from two places so data is
// captured reliably:
//   • the post-call webhook (hands-off, the moment ElevenLabs finishes), and
//   • the live conversation detail route (when a supervisor is watching and the
//     call reaches a terminal state — a safety net if the webhook isn't wired).
// completeAIConversation() is idempotent, so running both is safe.
// ─────────────────────────────────────────────────────────────────────────────

export interface Turn {
  role?: string;
  speaker?: string;
  message?: string;
  text?: string;
}

export interface FinalizeResult {
  connected: boolean;
  outcome: CallOutcome;
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  appointment: { when: string; notes: string } | null;
}

/** Did a real two-way conversation happen (the homeowner actually spoke)? */
function didConnect(turns: Turn[], status: string): boolean {
  const human = turns.some(
    (t) =>
      (t.role ?? t.speaker) !== "agent" &&
      (t.message ?? t.text ?? "").trim().length > 1,
  );
  const s = status.toLowerCase();
  return human && s !== "failed" && s !== "error";
}

export async function finalizeAIConversation(input: {
  conversationId: string;
  turns: Turn[];
  status?: string;
  durationSec?: number;
  terminationReason?: string;
  lead?: Lead | null;
}): Promise<FinalizeResult> {
  const { conversationId, turns } = input;

  const transcript = turns
    .map((t) => `${t.role ?? t.speaker ?? "agent"}: ${t.message ?? t.text ?? ""}`)
    .filter((line) => line.trim().length > 3)
    .join("\n");

  const connected = didConnect(turns, input.status ?? "");

  const tracked = getAICall(conversationId);
  const lead =
    input.lead ?? (tracked?.leadId ? await getLeadById(tracked.leadId) : null);

  let summary: string;
  let outcome: CallOutcome;
  let sentiment: "positive" | "neutral" | "negative";
  let appointment: { when: string; notes: string } | null = null;

  if (connected) {
    const { data: analysis } = await analyzeConversation({ transcript, lead });
    summary = analysis.summary;
    outcome = analysis.outcome;
    sentiment = analysis.sentiment;
    appointment = analysis.appointment.requested
      ? { when: analysis.appointment.when, notes: analysis.appointment.notes }
      : null;
  } else {
    outcome = unconnectedOutcome(
      input.terminationReason ?? input.status ?? "",
      input.durationSec ?? 0,
    );
    sentiment = "neutral";
    summary = dispositionBlurb(outcome);
  }

  // Live monitor (in-memory) — instant feedback.
  updateAICall(conversationId, {
    state: connected ? "completed" : "failed",
    endedAt: Date.now(),
    durationSec: input.durationSec,
    summary,
    outcome,
    sentiment,
    recordingAvailable: connected,
    appointment,
  });

  // Durable persistence (Supabase) — idempotent, attributed to the owner.
  await completeAIConversation({
    conversationId,
    summary,
    outcome,
    sentiment,
    durationSec: input.durationSec,
    appointment,
    state: connected ? "completed" : "failed",
  });

  return { connected, outcome, summary, sentiment, appointment };
}
