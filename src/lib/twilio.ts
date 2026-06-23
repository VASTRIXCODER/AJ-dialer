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

/**
 * True when an outbound caller ID is set. Required for *manual* (human, PSTN)
 * dialing — without it the voice webhook would emit `<Dial callerId="">`, which
 * Twilio rejects and the agent hears "an application error has occurred". Not
 * required to take over an AI call (that joins a conference, no caller ID).
 */
export function isCallerIdConfigured() {
  return Boolean(twilioConfig.callerId.trim());
}

/** True when enough is configured to place REST outbound calls (parallel dialing). */
export function isRestConfigured() {
  const c = twilioConfig;
  return Boolean(c.accountSid && c.authToken && c.callerId);
}

/** A URL Twilio can actually reach from the public internet (not localhost). */
function isPublicHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return false;
    if (host.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the public origin Twilio should call back to. Prefers an explicit,
 * public NEXT_PUBLIC_APP_URL; otherwise derives it from the incoming request's
 * forwarded host (works automatically in production). Returns null when no
 * publicly-reachable URL is available — callers then OMIT the callback rather
 * than sending an unreachable/relative one (which causes Twilio 21609 / 11200).
 */
export function getPublicBaseUrl(req?: Request): string | null {
  const candidates: string[] = [];
  if (process.env.NEXT_PUBLIC_APP_URL) candidates.push(process.env.NEXT_PUBLIC_APP_URL);
  if (req) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) candidates.push(`${proto}://${host}`);
    try {
      candidates.push(new URL(req.url).origin);
    } catch {
      /* ignore */
    }
  }
  for (const c of candidates) {
    const clean = c.replace(/\/+$/, "");
    if (isPublicHttpUrl(clean)) return clean;
  }
  return null;
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
