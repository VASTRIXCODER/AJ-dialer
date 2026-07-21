import {
  ANSWERED_STATUSES,
  applyTwilioCallStatus,
  TERMINAL_STATUSES,
} from "@/lib/ai-call-state";
import { losingLegs, markAnswered } from "@/lib/call-registry";
import {
  type AICallRef,
  getAICallRef,
  getAICallRefByCustomerSid,
} from "@/lib/db/records";
import {
  connectHumanCall,
  endHumanCallForLeg,
  ringHumanCall,
} from "@/lib/human-call-store";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getRestClient } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Receives Twilio call + recording status callbacks.
 *
 * This route is the system's source of truth for what a phone is actually doing.
 * Twilio is the only party that knows whether a human picked up — ElevenLabs
 * cannot tell us, because in bridge mode it is talking to our own Twilio
 * conference, which answers instantly. We used to subscribe to these events and
 * then throw the interesting ones away, which is why a call that rang out sat in
 * the Live Monitor as "In Progress" until something force-closed it minutes later.
 *
 * Three jobs:
 *   1. AI calls  — drive the conversation lifecycle (ringing → connected →
 *      no-answer), and hang up the AI agent when nobody answers.
 *   2. Human calls — drive `live_calls` presence, so the monitor no longer depends
 *      on the rep's browser tab staying alive.
 *   3. Recordings + parallel-dial winner selection (pre-existing).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const room = url.searchParams.get("room");
  const leadId = url.searchParams.get("leadId");
  const conversationId = url.searchParams.get("conversationId");

  const form = await req.formData();
  const callStatus = String(form.get("CallStatus") ?? "");
  const recordingStatus = String(form.get("RecordingStatus") ?? "");
  const recordingUrl = String(form.get("RecordingUrl") ?? "");
  const callSid = String(form.get("CallSid") ?? "");
  const errorCode = Number(form.get("ErrorCode")) || null;

  // ── Recording complete: save URL to the matching call record ────────────────
  // Manual calls are conferences, so the webhook carries the room (passed on the
  // callback URL) — match the record by room. If the record doesn't exist yet
  // (the rep is still wrapping up), park the URL in pending_recordings; the
  // insert claims it. We still try call_sid for any non-conference recordings.
  if (recordingStatus === "completed" && recordingUrl && isAdminConfigured()) {
    try {
      const admin = createAdminClient();
      const isHumanRoom = Boolean(room && room.startsWith("hc-"));
      if (isHumanRoom) {
        const { data: updated } = await admin
          .from("call_records")
          .update({ recording_url: recordingUrl })
          .eq("room", room)
          .is("recording_url", null)
          .select("id");
        // Record not written yet — park the recording so the insert can claim it.
        if (!updated || updated.length === 0) {
          await admin
            .from("pending_recordings")
            .upsert({ room, recording_url: recordingUrl }, { onConflict: "room" });
        }
      } else if (callSid) {
        await admin
          .from("call_records")
          .update({ recording_url: recordingUrl })
          .eq("call_sid", callSid)
          .is("recording_url", null);
      }
    } catch {
      /* best-effort */
    }
  }

  // ── AI call: the homeowner's leg is the whole truth ─────────────────────────
  // Human conference legs carry `room=hc-…` and never a conversationId, so skip
  // them rather than spend a lookup per event proving they aren't AI calls.
  const maybeAi = Boolean(conversationId) || !room;
  if (callStatus && maybeAi) {
    await handleAiLeg({ conversationId, callSid, callStatus, errorCode });
  }

  // ── Human call: drive live presence straight off Twilio ─────────────────────
  // room is `hc-<humanId>` (see use-dialer), and live_calls.id IS that humanId.
  if (room?.startsWith("hc-") && callStatus) {
    const humanId = room.slice(3);
    try {
      if (callStatus === "ringing") {
        await ringHumanCall(humanId);
      } else if (ANSWERED_STATUSES.has(callStatus)) {
        await connectHumanCall(humanId, leadId);
      } else if (TERMINAL_STATUSES.has(callStatus) && leadId) {
        // Only ends the row if THIS is the leg that answered — a losing parallel
        // leg terminating must not yank a live call off the monitor.
        await endHumanCallForLeg(humanId, leadId);
      }
    } catch {
      /* presence is best-effort — never fail a Twilio webhook over it */
    }
  }

  // ── Parallel-dial winner: release the losing legs ───────────────────────────
  // CRITICAL: only release a leg that is still RINGING. A leg that already
  // ANSWERED must never be hung up here. In a 3X dial two homeowners can pick up
  // within the same ~1.5s window, and the two "who won?" authorities can disagree:
  // this webhook picks the winner by which `answered` callback arrived FIRST
  // (markAnswered), while the rep's browser bridges the call to the first answered
  // leg in PLACEMENT order (the /api/twilio/answered poll). When those differ, the
  // old code — which completed every non-winner leg regardless of status — hung up
  // the very homeowner the rep was now talking to, dropping the call the instant
  // "connected" appeared. Fetching each loser's live status and skipping any that
  // is no longer ringing makes an answered leg untouchable no matter which
  // authority labeled it a "loser"; at worst a rare double-answer leaves one extra
  // homeowner in the room briefly, which the rep can end — never a dropped call.
  if (room && leadId && ANSWERED_STATUSES.has(callStatus)) {
    const isWinner = markAnswered(room, leadId);
    if (isWinner) {
      const client = await getRestClient();
      if (client) {
        const STILL_RINGING = new Set(["queued", "initiated", "ringing"]);
        await Promise.all(
          losingLegs(room, leadId).map(async (leg) => {
            if (!leg.sid) return;
            try {
              const c = await client.calls(leg.sid).fetch();
              if (STILL_RINGING.has(c.status)) {
                await client.calls(leg.sid).update({ status: "completed" });
              }
            } catch {
              /* leg already gone — nothing to release */
            }
          }),
        );
      }
    }
  }

  // ── Persist Twilio's own verdict on the call ────────────────────────────────
  // Twilio knows things we otherwise throw away: whether the leg was actually
  // answered, and the error code when it wasn't (21210/21212 bad caller ID, 21610
  // blocked, 13224 geo-permissions…).
  //
  // This used to key on `.eq("call_sid", callSid)` — the HOMEOWNER leg's SID. But
  // call_records.call_sid holds the REP's browser-leg SID for manual calls and the
  // AGENT's leg SID for AI calls. It never holds this one. So the update matched
  // zero rows on every single call, and these columns were always null. Conference
  // calls carry the room, so match on that instead — the same way the recording
  // path above already does.
  if (TERMINAL_STATUSES.has(callStatus) && isAdminConfigured()) {
    try {
      const admin = createAdminClient();
      const verdict = {
        twilio_call_status: callStatus,
        twilio_error_code: errorCode,
        answered_by: String(form.get("AnsweredBy") ?? "") || null,
      };
      if (room) {
        await admin.from("call_records").update(verdict).eq("room", room);
      } else if (callSid) {
        await admin.from("call_records").update(verdict).eq("call_sid", callSid);
      }
    } catch {
      /* best-effort */
    }
  }

  // Twilio parses a status-callback response as TwiML. Returning a JSON body made
  // it log "15003 Warning Response to Callback URL" on every single call. An empty
  // 204 is what it actually wants.
  return new Response(null, { status: 204 });
}

/**
 * Resolve which AI conversation this leg belongs to, then hand it to the shared
 * transition table in ai-call-state.ts (the same one the direct-mode poller uses,
 * so push and poll can never disagree).
 */
async function handleAiLeg(input: {
  conversationId: string | null;
  callSid: string;
  callStatus: string;
  errorCode: number | null;
}): Promise<void> {
  const { callSid, callStatus, errorCode } = input;

  // The query param is the fast path; the SID lookup is the fallback for when it's
  // lost, so a no-answer event is never silently dropped on the floor.
  let ref: AICallRef | null = null;
  if (input.conversationId) ref = await getAICallRef(input.conversationId);
  if (!ref && callSid) ref = await getAICallRefByCustomerSid(callSid);
  if (!ref) return; // not an AI leg — a human leg, or a call we don't track

  try {
    await applyTwilioCallStatus({
      conversationId: ref.conversationId,
      agentCallSid: ref.callSid,
      callStatus,
      errorCode,
    });
  } catch {
    /* best-effort — the cron reconciler will catch anything we drop */
  }
}
