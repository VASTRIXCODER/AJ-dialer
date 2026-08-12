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
 * Where Twilio's webhooks should land, when we want them somewhere specific.
 *
 * Defaults to the Vercel origin rather than the Cloudflare-fronted custom domain
 * ON PURPOSE: these are machine-to-machine callbacks, so they gain nothing from
 * the CDN and stand to lose from it — a WAF false-positive or a rate limit
 * during the callback burst of a 3X parallel dial would silently eat them, the
 * same way they were silently eaten before. Going straight to Vercel keeps the
 * path as short and as boring as possible. This is also the origin the Supabase
 * pg_cron jobs already call.
 *
 * Set TWILIO_CALLBACK_BASE_URL to repoint it without a code change; set it to an
 * empty string to unpin entirely and fall back to the request's own origin.
 */
const DEFAULT_CALLBACK_BASE_URL = "https://aiatworkdialer.vercel.app";
const CALLBACK_BASE_URL =
  process.env.TWILIO_CALLBACK_BASE_URL ?? DEFAULT_CALLBACK_BASE_URL;

/**
 * Resolve the public origin Twilio should call back to. Order: the pinned
 * callback origin, then the origin THIS request actually arrived on, then
 * NEXT_PUBLIC_APP_URL (needed for request-less callers). Returns null when no
 * publicly-reachable URL is available — callers then OMIT the callback rather
 * than sending an unreachable/relative one (which causes Twilio 21609 / 11200).
 *
 * NEXT_PUBLIC_APP_URL is deliberately LAST. It used to win, and a stale value
 * silently broke every callback in production: the Vercel project had been
 * renamed, so it pointed at an alias that 307-redirects to the current one.
 * Twilio followed the redirect as a GET, hit a POST-only route, and logged 405
 * — but callbacks are fire-and-forget, so nothing surfaced and recordings and
 * call verdicts simply never came back. Every remaining candidate here is one
 * that resolves in a single hop.
 */
export function getPublicBaseUrl(req?: Request): string | null {
  const candidates: string[] = [CALLBACK_BASE_URL];
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
 * Verify an inbound Twilio webhook's `X-Twilio-Signature`. Twilio HMAC-SHA1s the
 * EXACT callback URL we configured (built by getPublicBaseUrl at placement time)
 * plus the sorted POST params, keyed on the account auth token. We reconstruct
 * the URL from the same origins getPublicBaseUrl would produce and accept if ANY
 * candidate validates — so a proxy hop (Cloudflare → Vercel) that rewrites the
 * host can't cause a false reject and silently drop real callbacks.
 *
 * Returns true (skips) when there's no auth token (demo / unconfigured) or when
 * TWILIO_SKIP_SIGNATURE=true is set — an emergency valve in case a specific
 * edge/proxy setup makes reconstruction diverge in production.
 */
export async function verifyTwilioSignature(
  req: Request,
  params: Record<string, string>,
): Promise<boolean> {
  const token = twilioConfig.authToken;
  if (!token) return true;
  if (process.env.TWILIO_SKIP_SIGNATURE === "true") return true;

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  let pathname = "";
  let search = "";
  try {
    const u = new URL(req.url);
    pathname = u.pathname;
    search = u.search;
  } catch {
    return false;
  }

  const bases = new Set<string>();
  const pinned = getPublicBaseUrl(req);
  if (pinned) bases.add(pinned);
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) bases.add(`${proto}://${host}`);
  try {
    bases.add(new URL(req.url).origin);
  } catch {
    /* ignore */
  }

  const twilioSdk = (await import("twilio")).default;
  for (const base of bases) {
    try {
      if (twilioSdk.validateRequest(token, signature, `${base}${pathname}${search}`, params)) {
        return true;
      }
    } catch {
      /* try the next candidate origin */
    }
  }
  return false;
}

/**
 * Read a Twilio webhook's url-encoded form body into a plain object AND verify
 * its signature in one pass — the request body can only be consumed once, so the
 * two have to happen together. Returns the params on a valid signature, or null
 * when the signature is missing/invalid (the caller should then reject).
 */
export async function readVerifiedTwilioForm(
  req: Request,
): Promise<Record<string, string> | null> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";
  return (await verifyTwilioSignature(req, params)) ? params : null;
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

/**
 * Point a Twilio number's inbound Messaging webhook at the app, so an inbound SMS
 * (a STOP opt-out) is delivered to /api/twilio/sms instead of 404ing at whatever
 * stale URL the number was left on (see error.txt / docs/CALLER_ID_DELIVERABILITY).
 */
export async function setNumberSmsWebhook(phoneNumber: string, smsUrl: string): Promise<void> {
  const client = await getRestClient();
  if (!client) throw new Error("Twilio REST client not configured");
  const matches = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  const match = matches[0];
  if (!match) throw new Error(`Twilio number ${phoneNumber} not found on this account`);
  await client.incomingPhoneNumbers(match.sid).update({ smsUrl, smsMethod: "POST" });
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

// ─────────────────────────────────────────────────────────────────────────────
// Voice SDK identity continuity.
//
// A Voice access token is short-lived, but the IDENTITY it carries must not
// change across renewals: Twilio's Device.updateToken() renews the token for the
// registered client, so a token minted for a different identity re-registers the
// browser as somebody else. Renewal therefore has to be able to say "keep the
// identity I already have" — and that claim has to be one the client can't
// forge, or one rep could register a second Device under another rep's identity
// (two Devices sharing an identity is precisely the collision that lets one
// rep's signalling disrupt another's live call).
//
// So the token route signs each identity it mints and the client hands the
// signature back on renewal. Same HMAC-on-the-auth-token scheme as above.
// ─────────────────────────────────────────────────────────────────────────────

/** Sign an `${exp}.${sig}` proof that WE issued `identity`. */
export function signIdentity(identity: string, ttlSec = 86_400): string {
  const secret = twilioConfig.authToken;
  if (!secret) return "";
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`id.${identity}.${exp}`)
    .digest("hex");
  return `${exp}.${sig}`;
}

/** True when `proof` is an unexpired signature this server issued for `identity`. */
export function verifyIdentity(identity: string, proof: string): boolean {
  const secret = twilioConfig.authToken;
  if (!secret || !identity) return false;
  const [exp, sig] = (proof || "").split(".");
  if (!exp || !sig) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`id.${identity}.${exp}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
