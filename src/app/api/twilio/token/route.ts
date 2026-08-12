import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  createVoiceToken,
  isRestConfigured,
  isVoiceConfigured,
  signIdentity,
  verifyIdentity,
} from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived Twilio Voice access token for the browser SDK.
 * Returns `{ mode: "offline" }` with no token when Twilio isn't configured (the
 * client then shows the device as offline rather than crashing); the AI path
 * still works server-side without a browser token.
 *
 * Two shapes:
 *  • no params            → mint a BRAND NEW identity (first load, reconnect)
 *  • `identity` + `proof` → renew the token for an identity we already issued
 */
export async function GET(req: Request) {
  if (!isVoiceConfigured()) {
    return NextResponse.json({ mode: "offline" });
  }

  // AUTH: a Voice access token lets the browser SDK dial through our TwiML app,
  // so it must never be minted for an anonymous caller. When Supabase is
  // configured (production), require a signed-in user; demo mode (no Supabase)
  // stays open so the dialer is explorable. Returning the "offline" shape keeps
  // the client's existing no-token handling working instead of throwing.
  if (isSupabaseConfigured() && !(await getUser())) {
    return NextResponse.json({ mode: "offline" }, { status: 401 });
  }

  // The Voice SDK identity MUST be globally unique across every rep. Two browser
  // Devices that register with the SAME Twilio identity collide — Twilio treats
  // them as one client, and registration/signaling for one can disrupt the other
  // (a real "another rep's activity interfered with my call" vector). A bare
  // millisecond timestamp collides whenever two reps load or reconnect the dialer
  // in the same millisecond — entirely plausible org-wide at shift start or right
  // after a deploy, when everyone reconnects at once — so mix in a random suffix
  // to make a collision effectively impossible.
  //
  // A RENEWAL, though, must KEEP the identity it already has: Twilio's
  // Device.updateToken() renews the token for the registered client, so handing
  // it a token minted for a different identity re-registers the browser as
  // somebody else. The dialer refreshes on a 25-second health check, so minting a
  // fresh identity every time meant the Device silently changed Twilio client
  // names all day long — churn that lands squarely on top of an in-flight dial.
  //
  // The renewal claim is signed, not merely well-formed: an unforgeable proof is
  // what stops a caller from asking for a token under a DIFFERENT rep's identity
  // and re-creating the very collision described above. No valid proof → the
  // caller gets a new identity rather than the one they asked for.
  const params = new URL(req.url).searchParams;
  const requested = params.get("identity")?.trim() ?? "";
  const proof = params.get("proof")?.trim() ?? "";
  const identity =
    requested && verifyIdentity(requested, proof)
      ? requested
      : `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    // The client sends this back to renew WITHOUT changing identity.
    identityProof: signIdentity(identity),
    token,
    canDialOut: isRestConfigured(),
  });
}
