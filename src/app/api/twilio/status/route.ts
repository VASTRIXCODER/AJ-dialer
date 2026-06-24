import { NextResponse } from "next/server";
import { losingLegs, markAnswered } from "@/lib/call-registry";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getRestClient } from "@/lib/twilio";

export const dynamic = "force-dynamic";

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

  return NextResponse.json({ received: true });
}
