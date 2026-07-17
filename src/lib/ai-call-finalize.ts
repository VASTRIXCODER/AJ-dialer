import "server-only";

import { recordCallSuccess, recordProviderFailure } from "./ai-call-breaker";
import { getAICall, updateAICall } from "./ai-call-store";
import { isAIConfigured } from "./ai/claude";
import { readCall, resolveAppointment } from "./ai/appointment";
import { analyzeConversation } from "./ai/services";
import { classifyNonConversation, type FailureKind } from "./call-disposition";
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
  /**
   * null when the call failed for a SYSTEM reason (see `failureKind`) rather than
   * a homeowner one. A null outcome is excluded from every rate denominator by
   * isResolved() — a call the agent killed on connect must never be counted as
   * "the homeowner didn't answer".
   */
  outcome: CallOutcome | null;
  failureKind: FailureKind | null;
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
  /** ElevenLabs `metadata.error.code`, when the provider reported one. */
  errorCode?: string | null;
  /** ElevenLabs `metadata.error.reason` — where "exceeds your quota limit" appears. */
  errorReason?: string | null;
  /** Set when the caller already KNOWS this was a system fault (e.g. dial rejected). */
  failureKind?: FailureKind | null;
  lead?: Lead | null;
}): Promise<FinalizeResult> {
  const { conversationId, turns } = input;

  const transcript = turns
    .map((t) => `${t.role ?? t.speaker ?? "agent"}: ${t.message ?? t.text ?? ""}`)
    .filter((line) => line.trim().length > 3)
    .join("\n");

  const hasHumanTurn = turns.some(
    (t) =>
      (t.role ?? t.speaker) !== "agent" && (t.message ?? t.text ?? "").trim().length > 1,
  );
  const connected = !input.failureKind && didConnect(turns, input.status ?? "");

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
  let outcome: CallOutcome | null;
  let failureKind: FailureKind | null = null;
  let sentiment: "positive" | "neutral" | "negative";
  let appointment: { when: string; iso?: string; notes: string } | null = null;
  let qualification: FinalizeResult["qualification"];
  let score: number | undefined;

  if (connected) {
    const now = new Date();
    const tz = lead?.timezone || undefined;
    const { data: analysis, source } = await analyzeConversation({
      transcript,
      lead,
      now,
      tz,
    });
    summary = analysis.summary;
    outcome = analysis.outcome;
    sentiment = analysis.sentiment;

    // Build an appointment ONLY when a booking is corroborated — NEVER off the
    // model's `appointment.requested` flag alone. resolveAppointment returns an
    // empty iso whenever it can't parse a real clock time, and a bare
    // "requested=true" with no time is agreement-in-principle, not a booked slot.
    // Trusting it is exactly what filed phantom bookings AND appointment rows with
    // no date/time. We accept two corroborated shapes:
    //   • a concrete resolved slot (calendar-ready), or
    //   • the model itself committing to outcome==="appointment_booked" (a stronger
    //     signal than the flag) — a supported timeless proposal for the "later"
    //     bucket, reviewed by a human before it's approved.
    if (analysis.appointment.requested || outcome === "appointment_booked") {
      const slot = resolveAppointment(transcript, now, tz);
      if (slot.iso) {
        appointment = {
          when: slot.when,
          iso: slot.iso,
          notes: analysis.appointment.notes || slot.notes,
        };
      } else if (outcome === "appointment_booked") {
        appointment = {
          when: analysis.appointment.when || "",
          notes:
            analysis.appointment.notes ||
            "Homeowner agreed to a no-cost account review.",
        };
      }
      // else: requested=true but no resolvable time and the model didn't commit to
      // a booking — agreement in principle only. Leave the model's own outcome and
      // create no appointment (the readCall safety net below still catches a
      // genuine agent-confirmed booking).
    }
    qualification = analysis.qualification;
    score = analysis.confidence;

    // Deterministic safety net (speaker-aware): a clear booking or DNC in the
    // actual words beats a mislabeled disposition. readCall is decline-aware, so
    // the agent's scripted "you're all set" can no longer book over a customer's
    // explicit "not interested". High precision — only unambiguous signals.
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

    // An agreed appointment makes the disposition a booking. `appointment` is now
    // only ever set when corroborated above, so this can no longer fire on a bare
    // model flag and fabricate a booking.
    if (appointment && outcome !== "do_not_call") outcome = "appointment_booked";

    // A non-booking outcome (DNC, callback, not-interested, qualified) must never
    // carry a stray appointment — e.g. a DNC call that mentioned a time earlier —
    // into the pipeline, or routeDisposition would file an appointment row for a
    // lead that isn't booked.
    if (outcome !== "appointment_booked") appointment = null;

    // If the live analyzer SILENTLY fell back to the demo simulator (a thrown
    // Claude call — timeout, rate-limit, parse error), its "qualified" default is
    // a guess, not a read of the call. Only trust a fallback outcome that a
    // deterministic transcript signal corroborates; otherwise leave the call
    // unresolved (null → excluded from every rate) for human review rather than
    // auto-filing a positive the homeowner never earned. Demo mode (no API key)
    // is unaffected — its "qualified" is the intended label there.
    const analyzerFellBack = isAIConfigured() && source !== "claude";
    const corroborated =
      read.dnc || read.declined || read.callback || read.booked || appointment != null;
    if (analyzerFellBack && !corroborated) {
      outcome = null;
      summary =
        "This connected call couldn't be analyzed automatically (the AI analyzer was " +
        "temporarily unavailable) and no clear outcome signal was present in the transcript — " +
        "left for human review rather than auto-categorized.";
    }
  } else {
    // No two-way conversation. Decide WHY — and specifically, whether this was
    // the homeowner (a real outcome) or us (a system failure). Getting this wrong
    // is what let a total agent outage masquerade as a bad no-answer rate for days.
    const verdict = classifyNonConversation({
      terminationReason: input.terminationReason,
      status: input.status,
      durationSec: input.durationSec,
      errorCode: input.errorCode,
      errorReason: input.errorReason,
      hasHumanTurn,
      failureKind: input.failureKind,
    });
    sentiment = "neutral";
    summary = verdict.summary;
    if (verdict.kind === "outcome") {
      outcome = verdict.outcome;
    } else {
      // A system failure tells us NOTHING about the homeowner. Leave the call
      // un-dispositioned so it stays out of every rate denominator (isResolved)
      // rather than deflating the connect rate as a phantom "no answer".
      outcome = null;
      failureKind = verdict.failureKind;
      console.error("[ai-call] system failure", {
        conversationId,
        failureKind,
        durationSec: input.durationSec,
        terminationReason: input.terminationReason,
        errorCode: input.errorCode,
      });

      // Tell the breaker. This is what makes a RUNNING batch stop itself: the
      // first call to come back "out of credits" halts the remaining 1,499
      // before they ring anyone. Without this the batch just keeps dialing.
      if (
        failureKind === "provider_quota_exceeded" ||
        failureKind === "agent_terminated_on_connect" ||
        failureKind === "provider_error"
      ) {
        recordProviderFailure(failureKind, input.errorReason ?? input.terminationReason ?? "");
      }
    }
  }

  // A real two-way conversation means the provider is healthy again.
  if (connected) recordCallSuccess();

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
    failureKind,
    terminationReason: input.terminationReason ?? input.status ?? null,
    sentiment,
    durationSec: input.durationSec,
    appointment,
    state: connected ? "completed" : "failed",
  });

  // Process the extracted data back onto the lead (bill, solar, EV/pool/battery,
  // score, status) so the CRM reflects what the AI learned on the call.
  if (connected && outcome) {
    await enrichLeadFromAI({ conversationId, outcome, score, qualification });
  }

  return { connected, outcome, failureKind, summary, sentiment, appointment };
}
