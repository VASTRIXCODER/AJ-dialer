import { twilioConfig } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * TwiML endpoint invoked by the Voice SDK / TwiML App when the browser places
 * an outbound call. It dials the requested PSTN number using the configured
 * caller ID and (optionally) records the call.
 *
 * Configure your TwiML App's Voice Request URL to point here:
 *   {NEXT_PUBLIC_APP_URL}/api/twilio/voice
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const to = String(form.get("To") ?? "");
  const record = String(form.get("record") ?? "false") === "true";
  const callerId = twilioConfig.callerId;

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const recordAttr = record
    ? ' record="record-from-answer-dual" recordingStatusCallback="/api/twilio/status"'
    : "";

  const twiml = to
    ? `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escape(callerId)}"${recordAttr} answerOnBridge="true">
    <Number>${escape(to)}</Number>
  </Dial>
</Response>`
    : `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thanks for calling A I at work. No destination number was provided.</Say>
</Response>`;

  return new Response(twiml, {
    headers: { "Content-Type": "text/xml" },
  });
}
