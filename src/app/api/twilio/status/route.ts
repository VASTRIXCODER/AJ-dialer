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
  if (recordingStatus === "completed" && recordingUrl && callSid && isAdminConfigured()) {
    try {
      const admin = createAdminClient();
      // Match by the rep's call SID (written when the disposition is saved).
      // Also try matching AI conference recordings via the ai_conversations table.
      await Promise.all([
        admin
          .from("call_records")
          .update({ recording_url: recordingUrl })
          .eq("call_sid", callSid)
          .is("recording_url", null),
        admin
          .from("call_records")
          .update({ recording_url: recordingUrl })
          .eq("conversation_id", url.searchParams.get("conversationId") ?? "")
          .is("recording_url", null),
      ]);
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
