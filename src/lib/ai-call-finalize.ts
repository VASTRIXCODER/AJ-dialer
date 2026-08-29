import "server-only";

import { recordCallSuccess, recordProviderFailure } from "./ai-call-breaker";
import { getAICall, updateAICall } from "./ai-call-store";
import { orgLikeForConversation } from "./ai/agent-context";
import { analyzeCall } from "./ai/analyze-call";
import { isAIConfigured } from "./ai/claude";
import { readCall, resolveAppointment } from "./ai/appointment";
import { orgAIContext } from "./ai/org-context";
import { analyzeConversation } from "./ai/services";
import { classifyNonConversation, type FailureKind } from "./call-disposition";
import { getLeadById, getLeadByIdAdmin, getLeadByPhoneAdmin } from "./db/leads";
import {
  completeAIConversation,
  enrichLeadFromAI,
  getConversationLeadRef,
} from "./db/records";
import { publishOrgEvent } from "./realtime/publish";
import { createAdminClient, isAdminConfigured } from "./supabase/admin";
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
  /** Offset into the call, as ElevenLabs reports it (webhook + API shapes). */
  time_in_call_secs?: number;
  secs?: number | null;
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

/**
 * Did the agent deliver its scripted voicemail-drop message with nobody ever
 * replying? Per agent-prompt.ts's "Voicemail" section, reaching an answering
 * machine has the agent leave a specific closing message ending "I'll try you
 * again" — a phrase distinctive enough that matching it (rather than just
 * counting characters) doesn't get confused with the agent briefly answering
 * an automated call-SCREENING prompt ("who's calling?"), which per the
 * "Call screening" prompt section she's now instructed to do plainly and
 * keep going, not to bail into the voicemail message. A screener exchange can
 * easily exceed 40 characters of agent speech too, so length alone isn't a
 * safe signal for "this was voicemail" — it just means nobody replied.
 */
function looksLikeVoicemailDrop(turns: Turn[], hasHumanTurn: boolean): boolean {
  if (hasHumanTurn) return false;
  const agentText = turns
    .filter((t) => (t.role ?? t.speaker) === "agent")
    .map((t) => (t.message ?? t.text ?? "").trim())
    .join(" ");
  return /i'?ll try you again/i.test(agentText);
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
  let callback: { when: string; iso?: string; reason?: string } | null = null;
  let qualification: FinalizeResult["qualification"];
  let score: number | undefined;

  if (connected) {
    const now = new Date();
    const tz = lead?.timezone || undefined;
    // Analyze with the CALLING org's AI context — its vertical framing and
    // vocabulary, not solar's. For non-solar orgs the analysis carries no solar
    // qualification block, so nothing solar is ever written back to their lead
    // below. Null (demo / unstamped conversation) keeps the solar default.
    const orgLike = await orgLikeForConversation(conversationId);
    const { data: analysis, source } = await analyzeConversation({
      transcript,
      lead,
      now,
      tz,
      ctx: orgAIContext(orgLike),
    });
    summary = analysis.summary;
    outcome = analysis.outcome;
    sentiment = analysis.sentiment;

    // Build an appointment ONLY when a DATE was actually resolved from the
    // transcript — never off the model's `appointment.requested`/`outcome`
    // flags alone. resolveAppointment() now requires BOTH a concrete time AND
    // an explicit date reference ("tomorrow", "Tuesday", a calendar date, …);
    // if either is missing it returns an empty slot. Policy: if a date was
    // mentioned, there's an appointment — otherwise there isn't, no matter how
    // confidently the model says "appointment_booked". This used to also
    // accept the model's bare outcome flag as a "timeless proposal," which is
    // exactly what filed appointment rows with no date/time on them.
    if (analysis.appointment.requested || outcome === "appointment_booked") {
      const slot = resolveAppointment(transcript, now, tz);
      if (slot.iso) {
        appointment = {
          when: slot.when,
          iso: slot.iso,
          notes: analysis.appointment.notes || slot.notes,
        };
      } else if (outcome === "appointment_booked") {
        // The model claimed a booking but no date was actually mentioned in
        // the transcript — per policy that's not a booked appointment. The
        // conversation itself was still good, so keep the signal as
        // "qualified" rather than losing it (or worse, filing a dateless
        // appointment row) outright.
        outcome = "qualified";
      }
      // else: requested=true but no resolvable date and the model didn't commit
      // to a booking — agreement in principle only. Leave the model's own
      // outcome and create no appointment (the readCall safety net below still
      // catches a genuine agent-confirmed booking with a real date).
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

    // A callback the agent AGREED A TIME for should reach the Callbacks board
    // with that time on it. Same resolver and the same bar as a booking — a
    // concrete clock time AND an explicit date reference — so "call me sometime
    // next week" still files with no due date rather than inventing one. Without
    // this every AI-scheduled callback landed permanently in "Due now".
    if (outcome === "callback_scheduled") {
      const slot = resolveAppointment(transcript, now, tz);
      if (slot.iso) {
        callback = {
          when: slot.when,
          iso: slot.iso,
          reason: analysis.appointment.notes || summary,
        };
      }
    }

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
      voicemailSignal: looksLikeVoicemailDrop(turns, hasHumanTurn),
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

  // AI summaries are appointment-only by policy: a Claude-written narrative is
  // persisted ONLY for calls that actually booked. The analyzer still ran (it
  // owns the outcome), but its prose is dropped for every other connected
  // result. Deterministic texts stay: non-conversation verdicts ("No answer…")
  // and the analyzer-fell-back explanation (outcome === null) aren't AI
  // summaries — they're labels the archive needs to stay honest.
  if (connected && outcome !== "appointment_booked" && outcome !== null) {
    summary = "";
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
  // The normalized turn array rides along so the dashboard can serve ended
  // calls from the DB instead of re-hitting the ElevenLabs API forever.
  await completeAIConversation({
    conversationId,
    summary,
    outcome,
    failureKind,
    terminationReason: input.terminationReason ?? input.status ?? null,
    sentiment,
    durationSec: input.durationSec,
    appointment,
    callback,
    state: connected ? "completed" : "failed",
    transcript: turns
      .map((t) => ({
        role: String(t.role ?? t.speaker ?? "agent"),
        message: String(t.message ?? t.text ?? ""),
        secs:
          typeof t.secs === "number"
            ? t.secs
            : typeof t.time_in_call_secs === "number"
              ? t.time_in_call_secs
              : null,
      }))
      .filter((t) => t.message.trim().length > 0),
  });

  // Floor broadcast: this conversation is OVER, whatever the outcome. One cheap
  // row read resolves where to publish (the org was stamped at seed time);
  // best-effort — the monitors' fallback poll is the backstop.
  if (isAdminConfigured()) {
    try {
      const { data: convRow } = await createAdminClient()
        .from("ai_conversations")
        .select("org_id, owner_id, lead_id, lead_name")
        .eq("conversation_id", conversationId)
        .maybeSingle();
      if (convRow?.org_id) {
        publishOrgEvent(String(convRow.org_id), "call.state", {
          kind: "ai",
          id: conversationId,
          ownerId: convRow.owner_id ? String(convRow.owner_id) : null,
          leadId: convRow.lead_id ? String(convRow.lead_id) : null,
          leadName: String(convRow.lead_name ?? ""),
          state: "ended",
          stateSince: new Date().toISOString(),
          terminationReason: input.terminationReason ?? input.status ?? null,
        });
      }
    } catch {
      /* best-effort */
    }
  }

  // Process the extracted data back onto the lead (bill, solar, EV/pool/battery,
  // score, status) so the CRM reflects what the AI learned on the call.
  if (connected && outcome) {
    await enrichLeadFromAI({ conversationId, outcome, score, qualification });
  }

  // F1 structured pass — AUGMENTS the legacy analyzeConversation flow above
  // (which keeps owning the outcome, the appointment resolution, and the lead
  // enrichment): one combined generateJSON writes typed call_artifacts rows
  // (confidence + transcript-turn evidence + model provenance) and runs the
  // org's disposition policy (auto-apply into an empty slot, or the
  // needs-review queue). Fire-and-forget: this runs on webhook / live-detail
  // paths that must not wait out a second Claude round-trip, and analyzeCall
  // itself never throws and persists nothing in demo mode.
  if (connected && isAdminConfigured()) {
    try {
      const { data: rec } = await createAdminClient()
        .from("call_records")
        .select("id, org_id")
        .eq("conversation_id", conversationId)
        .maybeSingle();
      if (rec?.id && rec.org_id) {
        void analyzeCall({
          conversationId,
          callRecordId: String(rec.id),
          orgId: String(rec.org_id),
          lead,
          transcriptTurns: turns
            .map((t) => ({
              role: String(t.role ?? t.speaker ?? "agent"),
              message: String(t.message ?? t.text ?? ""),
              secs:
                typeof t.secs === "number"
                  ? t.secs
                  : typeof t.time_in_call_secs === "number"
                    ? t.time_in_call_secs
                    : null,
            }))
            .filter((t) => t.message.trim().length > 0),
          outcome,
          durationSec: input.durationSec,
          // Summary artifacts follow the same appointment-only policy as the
          // finalize path above — the rest of the intelligence (facts,
          // objections, compliance flags, proposed disposition) always runs.
          includeSummary: outcome === "appointment_booked",
        }).catch(() => {});
      }
    } catch {
      /* best-effort — intelligence must never fail the finalize */
    }
  }

  return { connected, outcome, failureKind, summary, sentiment, appointment };
}
