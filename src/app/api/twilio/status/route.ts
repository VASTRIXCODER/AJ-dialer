import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Receives Twilio call + recording status callbacks. In a full deployment this
 * is where you'd persist call outcomes, recording URLs and durations to your
 * datastore and push live updates to the monitoring dashboard.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const payload = Object.fromEntries(form.entries());

  // eslint-disable-next-line no-console
  console.log("[twilio:status]", {
    callSid: payload.CallSid,
    status: payload.CallStatus,
    recordingUrl: payload.RecordingUrl,
    duration: payload.CallDuration,
  });

  return NextResponse.json({ received: true });
}
