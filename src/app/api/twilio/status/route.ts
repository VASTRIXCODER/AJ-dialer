import { losingLegs, markAnswered } from "@/lib/call-registry";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getRestClient } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/** Twilio call states that mean the leg is over and its verdict is final. */
const TERMINAL_STATUSES = new Set([
  "completed",
  "no-answer",
  "busy",
  "failed",
  "canceled",
]);

/**
 * Receives Twilio call + recording status callbacks.
 *
 * For parallel dialing, the callback URL carries `room` and `leadId`. When a leg
 * is answered we record the winner and hang up the other ringing legs so only
 * the first homeowner is bridged to the agent.
 *
 * For recording callbacks (RecordingStatus=completed), we save the recording URL
 * to the matching call_records row by call_sid.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const room = url.searchParams.get("room");
  const leadId = url.searchParams.get("leadId");

  const form = await req.formData();
  const callStatus = String(form.get("CallStatus") ?? "");
  const recordingStatus = String(form.get("RecordingStatus") ?? "");
  const recordingUrl = String(form.get("RecordingUrl") ?? "");
  const callSid = String(form.get("CallSid") ?? "");

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

  // ── Parallel-dial winner: hang up the losing legs ───────────────────────────
  if (room && leadId && (callStatus === "in-progress" || callStatus === "answered")) {
    const isWinner = markAnswered(room, leadId);
    if (isWinner) {
      const client = await getRestClient();
      if (client) {
        await Promise.all(
          losingLegs(room, leadId).map((leg) =>
            leg.sid
              ? client
                  .calls(leg.sid)
                  .update({ status: "completed" })
                  .catch(() => undefined)
              : undefined,
          ),
        );
      }
    }
  }

  // ── Persist Twilio's own verdict on the call ────────────────────────────────
  // Twilio knows things we otherwise throw away: whether the leg was actually
  // answered, and the error code when it wasn't (21210/21212 bad caller ID, 21610
  // blocked, 13224 geo-permissions…). None of it was ever stored, which is a big
  // part of why "the call never happened" and "nobody picked up" were
  // indistinguishable. Only applies to legs WE create — for direct-mode AI calls
  // ElevenLabs owns the Twilio leg and the truth comes from its metadata.error.
  if (callSid && TERMINAL_STATUSES.has(callStatus) && isAdminConfigured()) {
    try {
      const errorCode = Number(form.get("ErrorCode")) || null;
      await createAdminClient()
        .from("call_records")
        .update({
          twilio_call_status: callStatus,
          twilio_error_code: errorCode,
          answered_by: String(form.get("AnsweredBy") ?? "") || null,
        })
        .eq("call_sid", callSid);
    } catch {
      /* best-effort */
    }
  }

  // Twilio parses a status-callback response as TwiML. Returning a JSON body made
  // it log "15003 Warning Response to Callback URL" on every single call. An empty
  // 204 is what it actually wants.
  return new Response(null, { status: 204 });
}
