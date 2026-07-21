import { NextResponse } from "next/server";
import {
  createVoiceToken,
  isRestConfigured,
  isVoiceConfigured,
} from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived Twilio Voice access token for the browser SDK.
 * Returns `{ mode: "offline" }` with no token when Twilio isn't configured (the
 * client then shows the device as offline rather than crashing); the AI path
 * still works server-side without a browser token.
 */
export async function GET() {
  if (!isVoiceConfigured()) {
    return NextResponse.json({ mode: "offline" });
  }

  // The Voice SDK identity MUST be globally unique across every rep. Two browser
  // Devices that register with the SAME Twilio identity collide — Twilio treats
  // them as one client, and registration/signaling for one can disrupt the other
  // (a real "another rep's activity interfered with my call" vector). A bare
  // millisecond timestamp collides whenever two reps load or reconnect the dialer
  // in the same millisecond — entirely plausible org-wide at shift start or right
  // after a deploy, when everyone reconnects at once — so mix in a random suffix
  // to make a collision effectively impossible.
  const identity = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
