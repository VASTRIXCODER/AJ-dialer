import { twilioConfig } from "@/lib/twilio";

export const dynamic = "force-dynamic";

// Twilio recording SIDs are "RE" + 32 hex chars. Validate strictly so this route
// can only ever proxy a Twilio recording, never an arbitrary URL (no SSRF).
const RECORDING_SID = /^RE[0-9a-f]{32}$/i;

/**
 * Streams a Twilio call recording to the browser WITH the account credentials,
 * so the Monitor / Reports can play manual-call recordings (Twilio recording
 * media is private by default and 401s without HTTP Basic auth). Mirrors the
 * ElevenLabs audio proxy used for AI calls.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  const { sid } = await params;
  if (!RECORDING_SID.test(sid)) {
    return new Response("Invalid recording id", { status: 400 });
  }
  if (!twilioConfig.accountSid || !twilioConfig.authToken) {
    return new Response("Twilio not configured", { status: 503 });
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.accountSid}/Recordings/${sid}.mp3`;
  const auth = Buffer.from(
    `${twilioConfig.accountSid}:${twilioConfig.authToken}`,
  ).toString("base64");

  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok || !res.body) {
      return new Response("Recording unavailable", { status: 502 });
    }
    return new Response(res.body, {
      headers: {
        "content-type": res.headers.get("content-type") ?? "audio/mpeg",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Recording unavailable", { status: 502 });
  }
}
