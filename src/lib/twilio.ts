import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side Twilio configuration.
//
// Every value is read from the environment. When the required credentials are
// missing the app runs in DEMO MODE — the API routes return simulated payloads
// so the entire UI (including the dialer) is fully explorable without a Twilio
// account.
// ─────────────────────────────────────────────────────────────────────────────

export const twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  apiKeySid: process.env.TWILIO_API_KEY_SID ?? "",
  apiKeySecret: process.env.TWILIO_API_KEY_SECRET ?? "",
  twimlAppSid: process.env.TWILIO_TWIML_APP_SID ?? "",
  callerId: process.env.TWILIO_CALLER_ID ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

/** True when enough is configured to mint Voice access tokens for the browser SDK. */
export function isVoiceConfigured() {
  const c = twilioConfig;
  return Boolean(c.accountSid && c.apiKeySid && c.apiKeySecret && c.twimlAppSid);
}

/** True when enough is configured to place REST outbound calls (parallel dialing). */
export function isRestConfigured() {
  const c = twilioConfig;
  return Boolean(c.accountSid && c.authToken && c.callerId);
}

/**
 * Mint a Voice access token scoped to a TwiML app for inbound (browser) calls and
 * outbound dialing. Returns null in demo mode.
 */
export async function createVoiceToken(identity: string): Promise<string | null> {
  if (!isVoiceConfigured()) return null;

  const twilio = (await import("twilio")).default;
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const token = new AccessToken(
    twilioConfig.accountSid,
    twilioConfig.apiKeySid,
    twilioConfig.apiKeySecret,
    { identity, ttl: 3600 },
  );

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: twilioConfig.twimlAppSid,
      incomingAllow: true,
    }),
  );

  return token.toJwt();
}

/** Lazily build a configured Twilio REST client, or null in demo mode. */
export async function getRestClient() {
  if (!isRestConfigured()) return null;
  const twilio = (await import("twilio")).default;
  return twilio(twilioConfig.accountSid, twilioConfig.authToken);
}
