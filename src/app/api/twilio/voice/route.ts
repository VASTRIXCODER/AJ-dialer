import { getPublicBaseUrl, twilioConfig } from "@/lib/twilio";

export const dynamic = "force-dynamic";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * TwiML endpoint invoked by the Voice SDK / TwiML App when the browser places a
 * call. Two modes:
 *
 *  • `To` present       → single-line / manual dial: bridge the agent to the
 *                         homeowner using the configured caller ID (+ recording).
 *  • `Conference` present → parallel dial: drop the agent into their conference
 *                         room, where the first homeowner to answer is bridged.
 *
 * Point your TwiML App's Voice Request URL at: {NEXT_PUBLIC_APP_URL}/api/twilio/voice
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const to = String(form.get("To") ?? "");
  const conference = String(form.get("Conference") ?? "");
  const record = String(form.get("record") ?? "false") === "true";

  let body: string;

  if (conference) {
    body = `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false">${escape(conference)}</Conference></Dial>`;
  } else if (to) {
    // recordingStatusCallback must be an ABSOLUTE, publicly-reachable URL — a
    // relative path triggers Twilio 21609. Omit it if we can't build one.
    const base = getPublicBaseUrl(req);
    const recordAttr = record
      ? base
        ? ` record="record-from-answer-dual" recordingStatusCallback="${escape(`${base}/api/twilio/status`)}"`
        : ' record="record-from-answer-dual"'
      : "";
    body = `<Dial callerId="${escape(twilioConfig.callerId)}"${recordAttr} answerOnBridge="true"><Number>${escape(to)}</Number></Dial>`;
  } else {
    body = `<Say voice="Polly.Joanna">No destination was provided.</Say>`;
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`;
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}
