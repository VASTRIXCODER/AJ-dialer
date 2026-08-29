import "server-only";

import { finalizeAIConversation } from "./ai-call-finalize";
import { updateAICall } from "./ai-call-store";
import {
  claimAIConversationUnanswered,
  markAIConversationActive,
  markAIConversationRinging,
} from "./db/records";
import { publishOrgEvent } from "./realtime/publish";
import { createAdminClient, isAdminConfigured } from "./supabase/admin";
import { getRestClient } from "./twilio";

// ─────────────────────────────────────────────────────────────────────────────
// The AI call lifecycle, driven by Twilio's verdict on the HOMEOWNER's leg.
//
// Twilio is the only party that knows whether a real person picked up the phone.
// ElevenLabs cannot tell us: in bridge mode the agent is talking to our own Twilio
// conference, which answers instantly, so from ElevenLabs' side every call
// "connects" the moment it's placed — including the ones ringing out into a void.
//
// This is the ONE implementation of that transition table. It is reached two ways:
//   • push  — /api/twilio/status, ~1s after the real event (bridge mode)
//   • poll  — reconcileViaTwilio(), for direct mode where we can't attach a
//             callback to a leg ElevenLabs created
// Both must agree, so neither gets its own copy.
//
// Every transition is a compare-and-swap in SQL, never a read-then-write. Twilio
// does not guarantee callback ordering and these land on different serverless
// instances, so a late `ringing` must not drag a connected call backwards, and a
// `no-answer` must not stomp a homeowner who just picked up.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The leg is over and NOBODY EVER PICKED UP. Twilio's per-leg verdict is mutually
 * exclusive: a leg that was answered ends as `completed`; one that rang out ends as
 * one of these. `completed` is deliberately absent — treating it as a no-answer
 * would file every successful call as a miss.
 */
export const UNANSWERED_STATUSES = new Set([
  "no-answer",
  "busy",
  "failed",
  "canceled",
]);

/** The homeowner is on the line. */
export const ANSWERED_STATUSES = new Set(["in-progress", "answered"]);

/** Every Twilio status that means the leg is over, for any reason. */
export const TERMINAL_STATUSES = new Set([
  "completed",
  ...UNANSWERED_STATUSES,
]);

export interface TwilioLegVerdict {
  conversationId: string;
  /** The ElevenLabs agent's own Twilio leg — the one we hang up on a no-answer. */
  agentCallSid: string | null;
  /** Twilio's CallStatus for the HOMEOWNER's leg. */
  callStatus: string;
  /** Twilio's ErrorCode, when it sent one. */
  errorCode?: number | null;
}

export type AppliedTransition =
  | "ringing"
  | "connected"
  | "unanswered"
  | "ignored";

/**
 * Floor broadcast for a successful AI transition. One cheap row read resolves
 * where to publish (the conversation row carries org/owner/lead — stamped at
 * seed time); best-effort by contract, and the terminal "ended" is published
 * by finalizeAIConversation, not here.
 */
async function publishAiState(
  conversationId: string,
  state: "ringing" | "connected",
): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const { data } = await createAdminClient()
      .from("ai_conversations")
      .select("org_id, owner_id, lead_id, lead_name")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (!data?.org_id) return;
    publishOrgEvent(String(data.org_id), "call.state", {
      kind: "ai",
      id: conversationId,
      ownerId: data.owner_id ? String(data.owner_id) : null,
      leadId: data.lead_id ? String(data.lead_id) : null,
      leadName: String(data.lead_name ?? ""),
      state,
      stateSince: new Date().toISOString(),
      terminationReason: null,
    });
  } catch {
    /* best-effort — monitors poll as fallback */
  }
}

/**
 * Apply Twilio's verdict on the homeowner's leg to the conversation.
 *
 * Returns what it actually did, which is not always what it was told — losing a
 * compare-and-swap is a normal, expected outcome and reports as "ignored".
 */
export async function applyTwilioCallStatus(
  v: TwilioLegVerdict,
): Promise<AppliedTransition> {
  const { conversationId, callStatus, errorCode } = v;

  if (callStatus === "ringing") {
    // Their phone is audibly ringing — the state the monitor could never show,
    // because nothing ever told it.
    await markAIConversationRinging(conversationId);
    updateAICall(conversationId, { state: "ringing", ringingAt: Date.now() });
    await publishAiState(conversationId, "ringing");
    return "ringing";
  }

  if (ANSWERED_STATUSES.has(callStatus)) {
    // A real human picked up. (Or their voicemail — we have no AMD, and this is
    // honestly the limit of what Twilio alone can tell us.)
    await markAIConversationActive(conversationId);
    updateAICall(conversationId, {
      state: "in_progress",
      connectedAt: Date.now(),
    });
    await publishAiState(conversationId, "connected");
    return "connected";
  }

  if (UNANSWERED_STATUSES.has(callStatus)) {
    // Claim the call. The swap only wins from initiated/ringing, and only once.
    // If we lose it, the homeowner IS on the line — leave the live conversation
    // strictly alone rather than hang up on them mid-sentence.
    const claimed = await claimAIConversationUnanswered(conversationId, callStatus);
    if (!claimed) return "ignored";

    // We won: the AI is monologuing into an empty conference. Hang its leg up
    // before it burns any more credits talking to nobody.
    if (v.agentCallSid) {
      const client = await getRestClient();
      if (client) {
        try {
          await client.calls(v.agentCallSid).update({ status: "completed" });
        } catch {
          /* the agent leg may already be gone — finalize regardless */
        }
      }
    }

    // File it.
    //
    // `failureKind: null` on purpose: "they didn't pick up" is a fact about the
    // HOMEOWNER — a real, countable no_answer — not a fault in our system, so it
    // belongs in the connect-rate denominator.
    //
    // But we pass Twilio's ErrorCode when there is one, and that changes the
    // verdict: a leg that came back `failed` with 21210 (bad caller ID) or 21610
    // (blocked) never rang anybody's phone. classifyNonConversation files that as
    // `provider_error`, not a no-answer — which is the entire point of the
    // failure_kind split. A system fault must never be laundered into "the
    // homeowner ignored us".
    await finalizeAIConversation({
      conversationId,
      turns: [],
      status: "failed",
      terminationReason: callStatus, // no-answer | busy | failed | canceled
      errorCode: errorCode == null ? null : String(errorCode),
      failureKind: null,
    });
    updateAICall(conversationId, { state: "failed", endedAt: Date.now() });
    return "unanswered";
  }

  // `completed` (the leg WAS answered and has now hung up), `initiated`, `queued`:
  // deliberate no-ops. On `completed` ElevenLabs owns the verdict — it posts the
  // transcript to /api/elevenlabs/webhook, which finalizes with a real outcome.
  // The cron reconciler is the backstop if that webhook never arrives.
  return "ignored";
}
