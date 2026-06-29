import { elevenLabsConfig } from "@/lib/elevenlabs";
import {
  getPublicBaseUrl,
  isCallerIdConfigured,
  twilioConfig,
  verifyMonitorToken,
} from "@/lib/twilio";

const digits = (s: string) => s.replace(/\D/g, "");

export const dynamic = "force-dynamic";

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Wrap a TwiML body in a well-formed document with the right content type. */
function twiml(body: string) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

/** A spoken message + hang up — used for graceful failures (never a 500). */
function say(message: string) {
  return twiml(`<Say voice="Polly.Joanna">${escapeXml(message)}</Say><Hangup/>`);
}

/**
 * TwiML endpoint invoked by the Voice SDK / TwiML App when the browser places a
 * call. Modes:
 *
 *  • `Conference` + `Monitor` → supervisor live-listen: join the rep's conference
 *                         MUTED (hears everyone, heard by no one). Gated by a
 *                         signed token from /api/twilio/listen.
 *  • `Conference` present → rep call (single/parallel), supervisor take-over, or
 *                         parallel winner: join the conference room where the
 *                         homeowner is bridged. `record` records the conference.
 *  • `To` present       → legacy single PSTN dial: bridge to the homeowner using
 *                         the configured caller ID (+ recording).
 *
 * It must ALWAYS return valid TwiML with HTTP 200 — any non-200 or malformed
 * response makes Twilio play the generic "an application error has occurred" to
 * the caller. So every failure path returns a clear spoken message instead.
 *
 * Point your TwiML App's Voice Request URL at: {NEXT_PUBLIC_APP_URL}/api/twilio/voice
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const to = String(form.get("To") ?? "").trim();
    const conference = String(form.get("Conference") ?? "").trim();
    const monitor = String(form.get("Monitor") ?? "") === "true";
    const monitorToken = String(form.get("Token") ?? "");
    const record = String(form.get("record") ?? "false") === "true";

    // ── AI bridge: the ElevenLabs agent dialed our bridge number. Hold the leg
    // briefly; /api/elevenlabs/call moves it into the conference room by REST. ──
    const bridge = elevenLabsConfig.bridgeNumber.trim();
    if (bridge && to && digits(to) === digits(bridge)) {
      return twiml(`<Pause length="30"/>`);
    }

    // ── Supervisor live-listen: join MUTED, silently (no relay needed) ────────
    // Only a token signed by the authorized listen route gets in — this is what
    // keeps silent eavesdropping locked to permitted supervisors.
    if (conference && monitor) {
      if (!verifyMonitorToken(conference, monitorToken)) {
        return say("You're not authorized to listen to this call.");
      }
      const room = escapeXml(conference);
      return twiml(
        `<Dial><Conference startConferenceOnEnter="false" endConferenceOnExit="false" muted="true" beep="false">${room}</Conference></Dial>`,
      );
    }

    // ── Conference: rep call (single/parallel), or supervisor take-over ───────
    if (conference) {
      const room = escapeXml(conference);
      // Record the whole conference from the rep's leg (exactly one per room).
      // Pass the room back on the recording callback so /api/twilio/status can
      // link the finished recording to this call record — a conference recording
      // webhook carries the ConferenceSid, never the rep's CallSid.
      const base = getPublicBaseUrl(req);
      const recordingCb = base
        ? `${base}/api/twilio/status?room=${encodeURIComponent(conference)}`
        : "";
      const recordAttr = record
        ? recordingCb
          ? ` record="record-from-start" recordingStatusCallback="${escapeXml(recordingCb)}"`
          : ' record="record-from-start"'
        : "";
      return twiml(
        `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false" waitUrl=""${recordAttr}>${room}</Conference></Dial>`,
      );
    }

    // ── Single / manual dial: bridge to the homeowner over the PSTN ───────────
    if (to) {
      // A valid caller ID is mandatory for a PSTN <Dial>. Without it Twilio
      // rejects the call ("application error"), so fail with a clear message.
      const callerId = twilioConfig.callerId.trim();
      if (!callerId) {
        return say(
          "This dialer has no outbound caller I D configured. Please add a Twilio caller I D to place manual calls.",
        );
      }

      // recordingStatusCallback must be an ABSOLUTE, publicly-reachable URL — a
      // relative path triggers Twilio 21609. Omit it if we can't build one.
      const base = getPublicBaseUrl(req);
      const recordAttr = record
        ? base
          ? ` record="record-from-answer-dual" recordingStatusCallback="${escapeXml(`${base}/api/twilio/status`)}"`
          : ' record="record-from-answer-dual"'
        : "";
      return twiml(
        `<Dial callerId="${escapeXml(callerId)}"${recordAttr} answerOnBridge="true"><Number>${escapeXml(to)}</Number></Dial>`,
      );
    }

    return say("No destination was provided for this call.");
  } catch {
    // Never surface a 500 to Twilio — that becomes the generic spoken error.
    return say("We're sorry, something went wrong setting up this call.");
  }
}

/**
 * Browser-openable diagnostic (Twilio uses POST, so this never runs for real
 * calls). Visit this URL to confirm the webhook is reachable and to copy the
 * EXACT value your TwiML App's Voice Request URL must hold. A stale/wrong URL
 * there is the usual cause of "an application error has occurred" on manual
 * dials and supervisor take-overs (both go through this webhook).
 */
export async function GET(req: Request) {
  const base = getPublicBaseUrl(req);
  return Response.json({
    ok: true,
    message:
      "Twilio Voice webhook is reachable. Set your TwiML App → Voice → Request URL to the voiceUrl below, with HTTP method POST.",
    voiceUrl: base ? `${base}/api/twilio/voice` : null,
    method: "POST",
    callerIdConfigured: isCallerIdConfigured(),
    callerIdNote: isCallerIdConfigured()
      ? "Caller ID is set — manual PSTN dialing is enabled."
      : "No TWILIO_CALLER_ID — manual dialing is disabled (take-over still works).",
  });
}
