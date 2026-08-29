import "server-only";

import { getPublicBaseUrl, getRestClient } from "../twilio";
import { isMessagingConfigured, isMessagingSimulated } from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// The only place a message actually leaves the building.
//
// Structured on src/lib/email/resend.ts: report a configuration problem as a
// configuration problem, keep the simulate hooks, and never let a transport
// error look like anything other than a transport error.
//
// THREE SAFETY VALVES, all independent:
//   MESSAGING_SIMULATION=true     — never calls Twilio at all.
//   MESSAGING_SIMULATE_FAILURE=true — proves the retry and alert path works.
//   MESSAGING_ALLOWLIST=+1555…,+1555…  — refuses any recipient not on the list,
//     INDEPENDENT of simulation. That independence is the point: a staging
//     deploy misconfigured to point at production credentials can still only
//     reach the team's own handsets.
//
// Deliberately does NOT touch isRestConfigured or twilioConfig.callerId.
// Loosening the voice-side check would let a dial emit <Dial callerId="">, and
// messaging has no business making voice more permissive.
// ─────────────────────────────────────────────────────────────────────────────

export interface SendMessageInput {
  to: string;
  /** The thread's sticky number. Never the rotating caller-ID pool. */
  from: string;
  body: string;
  /**
   * Where Twilio posts delivery receipts. Must be live BEFORE the first send —
   * Twilio does not replay receipts, so anything sent before the route exists
   * has its delivery outcome lost permanently.
   */
  statusCallbackUrl?: string | null;
}

export interface SendMessageResult {
  ok: boolean;
  /**
   * Twilio's own id. Present on success and stored immediately — it is the
   * only way to ask "did this actually go?" for a row that got stuck, and
   * Twilio's Messages API has NO idempotency key, so a retry without it sends
   * a second real text.
   */
  providerSid?: string;
  /** Twilio's initial status: `queued` or `accepted`. NEVER `sent`. */
  providerStatus?: string;
  segments?: number;
  /**
   * True when no reachable callback origin resolved, so no delivery receipt
   * will ever arrive for this message. The row can then be marked as having no
   * receipts rather than sitting at `sending` forever with no explanation.
   */
  noReceipts?: boolean;
  error?: string;
  errorCode?: string;
  /** True when nothing was attempted because the config is wrong. */
  configProblem?: boolean;
  /** True when the allow-list refused the recipient. */
  notAllowlisted?: boolean;
}

// Re-exported so a caller that legitimately holds the transport does not need
// two imports. The definitions live in ./config precisely so that asking the
// question never drags in the ability to send — see that module's header.
export { isMessagingConfigured, isMessagingSimulated } from "./config";

/**
 * The recipients this deployment may reach, or null for "no restriction".
 * Compared on last-10 digits so formatting can't defeat it.
 */
function allowlist(): Set<string> | null {
  const raw = (process.env.MESSAGING_ALLOWLIST ?? "").trim();
  if (!raw) return null;
  const digits = raw
    .split(/[,\s]+/)
    .map((s) => s.replace(/\D/g, ""))
    .filter((d) => d.length >= 10)
    .map((d) => d.slice(-10));
  return digits.length ? new Set(digits) : null;
}

export function isAllowlisted(phone: string): boolean {
  const list = allowlist();
  if (!list) return true;
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length >= 10 && list.has(digits.slice(-10));
}

/**
 * Where Twilio posts delivery receipts, or null when no publicly-reachable
 * origin resolves. Null means OMIT the parameter — Twilio rejects an
 * unreachable or relative statusCallback with 21609, which would turn a
 * perfectly good message into a failed one over a URL detail.
 *
 * The cost of omitting it is that the message can never progress past `sending`
 * on our side, because `sent` and `delivered` are only ever written by a
 * receipt. The drain records that explicitly rather than leaving a row looking
 * stuck for a reason nobody can see.
 */
export function messageStatusCallbackUrl(): string | null {
  const base = getPublicBaseUrl();
  return base ? `${base}/api/twilio/message-status` : null;
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const to = (input.to ?? "").trim();
  const from = (input.from ?? "").trim();
  const body = (input.body ?? "").trim();

  if (!to || !from || !body) {
    return { ok: false, configProblem: true, error: "Missing recipient, sender or body." };
  }

  // Checked BEFORE the simulation branch on purpose: the allow-list must hold
  // whether or not simulation is on, so a staging run that loses its simulation
  // flag is still fenced.
  if (!isAllowlisted(to)) {
    return {
      ok: false,
      notAllowlisted: true,
      error: `${to} is not on MESSAGING_ALLOWLIST, so nothing was sent.`,
    };
  }

  if (process.env.MESSAGING_SIMULATE_FAILURE === "true") {
    // Named in the message so nobody mistakes a simulated failure for a real
    // one while reading production logs at 2am.
    return {
      ok: false,
      error: "Simulated failure (MESSAGING_SIMULATE_FAILURE=true).",
      errorCode: "SIMULATED",
    };
  }

  if (isMessagingSimulated()) {
    return {
      ok: true,
      // Prefixed and obviously fake, and it still satisfies the unique index
      // so the simulated path exercises the same dedupe as the real one.
      providerSid: `SIMULATED-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      providerStatus: "queued",
      segments: Math.max(1, Math.ceil(body.length / 160)),
    };
  }

  if (!isMessagingConfigured()) {
    return {
      ok: false,
      configProblem: true,
      error: "Messaging is not connected: TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing.",
    };
  }

  try {
    const client = await getRestClient();
    if (!client) {
      return { ok: false, configProblem: true, error: "Could not build a Twilio client." };
    }
    const callback =
      input.statusCallbackUrl === undefined
        ? messageStatusCallbackUrl()
        : input.statusCallbackUrl;
    const created = await client.messages.create({
      to,
      from,
      body,
      // Omitted rather than sent empty: an unreachable statusCallback is a
      // Twilio 21609, which would fail a message that was otherwise fine.
      ...(callback ? { statusCallback: callback } : {}),
    });
    return {
      ok: true,
      noReceipts: !callback,
      providerSid: created.sid,
      // Twilio returns `queued` or `accepted` here. Storing it verbatim keeps
      // provider truth separate from our own lifecycle — `sent` is written
      // only by a status callback that says so.
      providerStatus: String(created.status ?? "queued"),
      segments: Number(created.numSegments ?? 1) || 1,
    };
  } catch (e: unknown) {
    const err = e as { message?: string; code?: number | string; status?: number };
    return {
      ok: false,
      error: err?.message ? String(err.message) : "The message could not be sent.",
      errorCode: err?.code != null ? String(err.code) : undefined,
    };
  }
}

/**
 * Twilio error 21610 means the recipient has opted out of this sender — and
 * with a Messaging Service using Advanced Opt-Out, Twilio intercepts STOP and
 * may NEVER forward it to our webhook. So for those accounts this error is the
 * only signal an opt-out ever happened, and it has to be treated as
 * authoritative rather than as a delivery failure to retry.
 */
export const OPT_OUT_ERROR_CODE = "21610";

export function isOptOutError(errorCode: string | null | undefined): boolean {
  return String(errorCode ?? "") === OPT_OUT_ERROR_CODE;
}

/**
 * Errors worth another attempt. Everything else is a permanent fact about the
 * message or the recipient, and retrying it just spends money to be told the
 * same thing again.
 */
const RETRYABLE = new Set(["20429", "20003", "30001", "30002", "SIMULATED"]);

export function isRetryableError(errorCode: string | null | undefined): boolean {
  return RETRYABLE.has(String(errorCode ?? ""));
}
