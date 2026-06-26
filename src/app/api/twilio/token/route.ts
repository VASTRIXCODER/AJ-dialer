import { NextResponse } from "next/server";
import {
  createVoiceToken,
  isRestConfigured,
  isVoiceConfigured,
} from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived Twilio Voice access token for the browser SDK.
 * Returns `{ mode: "demo" }` with no token when Twilio isn't configured,
 * which puts the dialer into its fully-interactive simulation mode.
 */
export async function GET(req: Request) {
  if (!isVoiceConfigured()) {
    // Log which vars are absent so Vercel Function Logs pinpoint the gap fast.
    const missing = (
      [
        ["TWILIO_ACCOUNT_SID", process.env.TWILIO_ACCOUNT_SID],
        ["TWILIO_API_KEY_SID", process.env.TWILIO_API_KEY_SID],
        ["TWILIO_API_KEY_SECRET", process.env.TWILIO_API_KEY_SECRET],
        ["TWILIO_TWIML_APP_SID", process.env.TWILIO_TWIML_APP_SID],
      ] as [string, string | undefined][]
    )
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      console.error("[twilio/token] offline — missing env vars:", missing.join(", "));
    }
    return NextResponse.json({ mode: "offline" });
  }

  // On a token REFRESH the browser passes its current identity so the new token
  // stays bound to the same Device (updateToken must keep the identity stable);
  // a first mint gets a fresh one. Validated to a safe shape — never trusted raw.
  const requested = new URL(req.url).searchParams.get("identity") ?? "";
  const identity = /^agent-[a-z0-9]{1,40}$/i.test(requested)
    ? requested
    : `agent-${Date.now().toString(36)}`;
  const token = await createVoiceToken(identity);

  if (!token) {
    return NextResponse.json({ mode: "offline" });
  }

  // canDialOut tells the client whether human (rep↔customer) calls are possible.
  // They run through a conference where the homeowner is dialed in via Twilio
  // REST, so this needs full REST creds (Account SID + Auth Token + Caller ID).
  // Taking over an AI call only joins an existing conference, so it's unaffected.
  return NextResponse.json({
    mode: "live",
    identity,
    token,
    canDialOut: isRestConfigured(),
  });
}
