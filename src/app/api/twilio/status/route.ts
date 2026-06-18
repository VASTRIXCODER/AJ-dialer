import { NextResponse } from "next/server";
import { losingLegs, markAnswered } from "@/lib/call-registry";
import { getRestClient } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Receives Twilio call + recording status callbacks.
 *
 * For parallel dialing, the callback URL carries `room` and `leadId`. When a leg
 * is answered we record the winner and hang up the other ringing legs so only
 * the first homeowner is bridged to the agent. This is also where you'd persist
 * call outcomes, recording URLs, and durations to your datastore.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const room = url.searchParams.get("room");
  const leadId = url.searchParams.get("leadId");

  const form = await req.formData();
  const callStatus = String(form.get("CallStatus") ?? "");

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
