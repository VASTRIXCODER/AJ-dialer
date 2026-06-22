import "server-only";

import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Live call-audio listening config + auth.
//
// Twilio's Streams API forks an in-progress call's audio to a WebSocket WITHOUT
// disrupting the call, so a supervisor can listen passively while the AI keeps
// talking. That WebSocket relay can't live in serverless Next, so it runs as a
// standalone process (server/media-stream-server.mjs). This module signs the
// short-lived tokens both Twilio and the browser present to that relay.
//
// Unconfigured (no MEDIA_STREAM_URL / MEDIA_STREAM_SECRET) → the feature is
// simply hidden; nothing else is affected.
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = process.env.MEDIA_STREAM_SECRET ?? "";
const BASE = (process.env.MEDIA_STREAM_URL ?? "").replace(/\/+$/, "");

export function isMediaStreamConfigured(): boolean {
  return Boolean(SECRET && BASE && BASE.startsWith("wss://"));
}

export function mediaStreamBase(): string {
  return BASE;
}

/** Sign a `${exp}.${sig}` token bound to a room (the conversation's listen room). */
export function signListenToken(room: string, ttlSec = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(`${room}.${exp}`)
    .digest("hex");
  return `${exp}.${sig}`;
}

export function verifyListenToken(room: string, token: string): boolean {
  if (!SECRET) return false;
  const [exp, sig] = (token || "").split(".");
  if (!exp || !sig) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${room}.${exp}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
