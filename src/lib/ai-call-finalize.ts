import "server-only";

import { getAICall, updateAICall } from "./ai-call-store";
import { readCall, resolveAppointment } from "./ai/appointment";
import { analyzeConversation } from "./ai/services";
import { dispositionBlurb, unconnectedOutcome } from "./call-disposition";
import { getLeadById, getLeadByIdAdmin, getLeadByPhoneAdmin } from "./db/leads";
import {
  completeAIConversation,
  enrichLeadFromAI,
  getConversationLeadRef,
} from "./db/records";
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
  appointment: { when: string; iso?: string; notes: string } | null;
  qualification?: {
    utilityBill: number | null;
    solarPayment: number | null;
    hasEV: boolean;
    hasPool: boolean;
    hasBattery: boolean;
  };
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
  // Resolve the lead robustly. The webhook has no user session, so we must use
  // the service-role client (getLeadById would see nothing under RLS). Order:
  // explicit input → in-memory tracked ref → the seeded conversation row → phone.
  let lead: Lead | null = input.lead ?? null;
  if (!lead) {
    const ref = tracked?.leadId
      ? { leadId: tracked.leadId, phone: tracked.phone ?? "" }
      : await getConversationLeadRef(conversationId);
    if (ref?.leadId) {
      lead = (await getLeadByIdAdmin(ref.leadId)) ?? (await getLeadById(ref.leadId));
    }
    if (!lead && ref?.phone) lead = await getLeadByPhoneAdmin(ref.phone);
  }

  let summary: string;
  let outcome: CallOutcome;
  let sentiment: "positive" | "neutral" | "negative";
  let appointment: { when: string; iso?: string; notes: string } | null = null;
  let qualification: FinalizeResult["qualification"];
  let score: number | undefined;

  if (connected) {
    const now = new Date();
    const tz = lead?.timezone || undefined;
    const { data: analysis } = await analyzeConversation({
      transcript,
      lead,
      now,
      tz,
    });
    summary = analysis.summary;
    outcome = analysis.outcome;
    sentiment = analysis.sentiment;
    if (analysis.appointment.requested) {
      // Normalize the human-facing time deterministically from the transcript so
      // it's always a concrete, timezone-anchored slot — even if the model left
      // it relative ("tomorrow at 6"). Falls back to the model's value if the
      // resolver can't parse a time.
      const slot = resolveAppointment(transcript, now, tz);
      appointment = {
        when: slot.when || analysis.appointment.when,
        iso: slot.iso,
        notes: analysis.appointment.notes || slot.notes,
      };
    }
    qualification = analysis.qualification;
    score = analysis.confidence;

    // Deterministic safety net (speaker-aware): a clear booking or DNC in the
    // actual words beats a mislabeled disposition. This is what stops a booked
    // appointment from being filed as "not interested" when the analyzer keys off
    // the agent's own "you're all set". High precision — only unambiguous signals.
    const read = readCall(transcript, now, tz);
    if (read.dnc && outcome !== "do_not_call") {
      outcome = "do_not_call";
      sentiment = "negative";
    } else if (read.booked && outcome !== "appointment_booked") {
      outcome = "appointment_booked";
      if (sentiment === "negative") sentiment = "neutral";
      if (!appointment) {
        appointment = {
          when: read.appointment.when || analysis.appointment.when,
          iso: read.appointment.iso || undefined,
          notes: read.appointment.notes || analysis.appointment.notes,
        };
      }
    }
    // If an appointment was genuinely agreed, the disposition must reflect it.
    if (appointment && outcome !== "do_not_call") outcome = "appointment_booked";
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

  // Process the extracted data back onto the lead (bill, solar, EV/pool/battery,
  // score, status) so the CRM reflects what the AI learned on the call.
  if (connected) {
    await enrichLeadFromAI({ conversationId, outcome, score, qualification });
  }

  return { connected, outcome, summary, sentiment, appointment };
}
