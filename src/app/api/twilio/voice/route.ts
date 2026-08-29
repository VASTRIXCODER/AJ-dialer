import { elevenLabsConfig } from "@/lib/elevenlabs";
import {
  getPublicBaseUrl,
  getRestClient,
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
      // No waitUrl override → Twilio plays its standard hold music to the rep
      // while the homeowner's line rings. The music stops automatically the
      // instant the homeowner joins the conference (two participants = active),
      // so it never interferes with the two-way audio bridge.
      return twiml(
        `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false"${recordAttr}>${room}</Conference></Dial>`,
      );
    }

    // ── Direct `To` PSTN dial: REMOVED, deliberately ──────────────────────────
    // This legacy branch bridged straight to any number the browser passed in
    // `device.connect({ params: { To } })`. No app code has used it since the
    // conference flow (/api/twilio/call) became the only dial path — but the
    // branch itself still answered, and it sat OUTSIDE every server-side
    // policy gate: no DNC scrub, no enforced calling hours, no max-attempts,
    // no org feature check. Any signed-in user with a Voice token could ring
    // any number from the org's caller ID by typing one line in the console —
    // exactly the calls the admin was told were now impossible. Every real
    // dial goes through /api/twilio/call, where the policy gates live.
    if (to) {
      return say(
        "Direct dialing through this line is disabled. Please use the dialer.",
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
 * EXACT value your TwiML App's Voice Request URL must hold.
 *
 * It also READS BACK what the TwiML App is actually pointed at, because a
 * stale/wrong URL there is the single most common cause of "I press Start, the
 * homeowner's phone rings, and then I'm dumped back to the Start screen": the
 * homeowner leg is placed by REST with inline TwiML and rings perfectly well,
 * while the REP's leg — the only one that goes through the TwiML App — dies on
 * an application error the instant it's created. Reporting the configured URL
 * next to the expected one turns that from a guess into a two-second check.
 */
export async function GET(req: Request) {
  const base = getPublicBaseUrl(req);
  const expected = base ? `${base}/api/twilio/voice` : null;

  // Read the TwiML App's live configuration. Best-effort: no REST creds, no app
  // SID, or a Twilio hiccup all degrade to "couldn't check" rather than failing.
  let twimlApp: {
    checked: boolean;
    voiceUrl: string | null;
    voiceMethod: string | null;
    matches: boolean | null;
    note: string;
  } = {
    checked: false,
    voiceUrl: null,
    voiceMethod: null,
    matches: null,
    note: "Couldn't read the TwiML App — check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_TWIML_APP_SID.",
  };

  const appSid = twilioConfig.twimlAppSid.trim();
  const client = appSid ? await getRestClient() : null;
  if (client && appSid) {
    try {
      const app = await client.applications(appSid).fetch();
      const configured = (app.voiceUrl ?? "").trim();
      const method = (app.voiceMethod ?? "").trim().toUpperCase();
      // Compare ignoring a trailing slash — Twilio stores it either way.
      const norm = (u: string) => u.replace(/\/+$/, "");
      const matches = Boolean(expected) && norm(configured) === norm(expected ?? "");
      twimlApp = {
        checked: true,
        voiceUrl: configured || null,
        voiceMethod: method || null,
        matches,
        note: !configured
          ? "Your TwiML App has NO Voice Request URL. The rep's browser leg cannot connect — set it to voiceUrl below (POST)."
          : matches
            ? method && method !== "POST"
              ? `Voice URL is correct but the method is ${method}. Twilio must POST — change it.`
              : "TwiML App Voice URL matches this app. The rep's browser leg has somewhere valid to land."
            : `TwiML App Voice URL points at ${configured}, NOT at this app. That is why the rep's side of the call fails while the homeowner still rings — set it to voiceUrl below (POST).`,
      };
    } catch (err) {
      twimlApp.note = `Couldn't read TwiML App ${appSid.slice(0, 6)}…: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  } else if (!appSid) {
    twimlApp.note =
      "No TWILIO_TWIML_APP_SID is set — the browser can't register a Voice device at all.";
  }

  return Response.json({
    ok: true,
    message:
      "Twilio Voice webhook is reachable. Set your TwiML App → Voice → Request URL to the voiceUrl below, with HTTP method POST.",
    voiceUrl: expected,
    method: "POST",
    twimlApp,
    callerIdConfigured: isCallerIdConfigured(),
    callerIdNote: isCallerIdConfigured()
      ? "Caller ID is set — outbound dialing via /api/twilio/call is enabled."
      : "No TWILIO_CALLER_ID — outbound dialing is disabled (take-over still works).",
  });
}
