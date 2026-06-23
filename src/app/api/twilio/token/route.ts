import { NextResponse } from "next/server";
import {
  createVoiceToken,
  isCallerIdConfigured,
  isVoiceConfigured,
} from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived Twilio Voice access token for the browser SDK.
 * Returns `{ mode: "demo" }` with no token when Twilio isn't configured,
 * which puts the dialer into its fully-interactive simulation mode.
 */
export async function GET() {
  if (!isVoiceConfigured()) {
    return NextResponse.json({ mode: "offline" });
  }

  const identity = `agent-${Date.now().toString(36)}`;
  const token = await createVoiceToken(identity);

  if (!token) {
    return NextResponse.json({ mode: "offline" });
  }

  // canDialOut tells the client whether *manual* PSTN dialing is possible (needs
  // a caller ID). Taking over an AI call doesn't — it joins a conference.
  return NextResponse.json({
    mode: "live",
    identity,
    token,
    canDialOut: isCallerIdConfigured(),
  });
}
