import "server-only";

import crypto from "node:crypto";

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
 * Resolve the public origin Twilio should call back to. Prefers the origin THIS
 * request actually arrived on, falling back to NEXT_PUBLIC_APP_URL (needed for
 * request-less callers). Returns null when no publicly-reachable URL is
 * available — callers then OMIT the callback rather than sending an
 * unreachable/relative one (which causes Twilio 21609 / 11200).
 *
 * The request origin wins on purpose. NEXT_PUBLIC_APP_URL used to win, and a
 * stale value silently broke every callback in production: it pointed at a
 * vercel.app host that 307-redirects to another vercel.app host, so Twilio was
 * handed a URL that never resolved to the app in one hop. Nothing surfaced —
 * callbacks are fire-and-forget, so recordings and call verdicts simply never
 * came back, for months. The host a rep is genuinely using is reachable by
 * definition and needs no redirect, which makes this self-healing: point the app
 * at any domain and its callbacks follow, no env var to keep in sync.
 */
export function getPublicBaseUrl(req?: Request): string | null {
  const candidates: string[] = [];
  if (req) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) candidates.push(`${proto}://${host}`);
  }
  if (process.env.NEXT_PUBLIC_APP_URL) candidates.push(process.env.NEXT_PUBLIC_APP_URL);
  if (req) {
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

  // A short (1h) TTL meant the token lapsed roughly every hour, and any live
  // call crossing that boundary had to survive an in-place token renewal — a
  // renewal that, if it hiccupped, dropped the call ("hangs up randomly in the
  // middle"). Twilio permits up to 24h; use the max so a token minted at the
  // start of a shift never expires mid-call. Idle renewal still runs client-side
  // (see use-dialer's ensureRegistered), so this only removes the mid-call
  // boundary, it doesn't weaken rotation between calls.
  const token = new AccessToken(
    twilioConfig.accountSid,
    twilioConfig.apiKeySid,
    twilioConfig.apiKeySecret,
    { identity, ttl: 86400 },
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

/**
 * Point a Twilio number's inbound Voice webhook at the app. A number left on
 * Twilio's demo webhook (or any stale URL) can't be used for dialing correctly —
 * see docs/CALLER_ID_DELIVERABILITY.md "config fixes".
 */
export async function setNumberVoiceWebhook(phoneNumber: string, voiceUrl: string): Promise<void> {
  const client = await getRestClient();
  if (!client) throw new Error("Twilio REST client not configured");
  const matches = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  const match = matches[0];
  if (!match) throw new Error(`Twilio number ${phoneNumber} not found on this account`);
  await client.incomingPhoneNumbers(match.sid).update({ voiceUrl, voiceMethod: "POST" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Supervisor live-listen authorization.
//
// A supervisor listens to a rep↔customer call by joining its Twilio conference
// MUTED (hears everyone, heard by no one) — no media relay required. The browser
// drives that join through the public TwiML voice webhook, so we gate it with a
// short-lived HMAC: the authorized /api/twilio/listen route signs the room, and
// the voice webhook verifies it before emitting a muted <Conference> join. This
// keeps silent eavesdropping locked to supervisors who passed the org/permission
// check. Keyed on the always-present Twilio auth token — no extra env var.
// ─────────────────────────────────────────────────────────────────────────────

/** Sign a `${exp}.${sig}` token authorizing a muted monitor join of `room`. */
export function signMonitorToken(room: string, ttlSec = 3600): string {
  const secret = twilioConfig.authToken;
  if (!secret) return "";
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${room}.${exp}`)
    .digest("hex");
  return `${exp}.${sig}`;
}

export function verifyMonitorToken(room: string, token: string): boolean {
  const secret = twilioConfig.authToken;
  if (!secret) return false;
  const [exp, sig] = (token || "").split(".");
  if (!exp || !sig) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${room}.${exp}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
