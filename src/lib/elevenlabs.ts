import "server-only";

import crypto from "node:crypto";
import type { Lead } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs Conversational AI integration (server-side).
//
// The AI agent places + conducts outbound calls through your Twilio number,
// records them, and posts transcripts/results back. Every value is read from the
// environment; when unconfigured, isElevenLabsConfigured() is false and the UI
// shows a connect prompt instead of attempting calls — nothing crashes.
//
// All HTTP shapes are centralized here so they're trivial to adjust if the
// ElevenLabs API evolves. Verify against https://elevenlabs.io/docs.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://api.elevenlabs.io";

export const elevenLabsConfig = {
  apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  agentId: process.env.ELEVENLABS_AGENT_ID ?? "",
  agentPhoneNumberId: process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID ?? "",
  webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET ?? "",
  /** E.164 rep number a supervisor "take over" transfers the live call to. */
  transferNumber: process.env.ELEVENLABS_TRANSFER_NUMBER ?? "",
};

/** True when the AI agent can place outbound calls. */
export function isElevenLabsConfigured() {
  const c = elevenLabsConfig;
  return Boolean(c.apiKey && c.agentId && c.agentPhoneNumberId);
}

/**
 * The single source of truth for the dynamic variables sent to the agent on
 * every call. The agent's prompt/first-message reference these with {{name}}
 * syntax so each conversation is personalized to the homeowner and matches the
 * Sunrun resolution script (name + address opener, EV/pool question, etc.).
 * Used by both the outbound-call route and the personalization webhook so the
 * agent gets identical context regardless of which path fires.
 */
export function agentVariablesForLead(
  lead: Lead,
): Record<string, string | number | boolean> {
  const homeAddress =
    [lead.address, lead.city, lead.state].filter(Boolean).join(", ") +
    (lead.zip ? ` ${lead.zip}` : "");
  return {
    customer_name: `${lead.firstName} ${lead.lastName}`.trim(),
    first_name: lead.firstName,
    last_name: lead.lastName,
    address: lead.address || lead.city || "your home",
    home_address: homeAddress || lead.city || "your home",
    city: lead.city,
    state: lead.state,
    solar_provider: lead.solarProvider || "Sunrun",
    utility_provider: lead.utilityProvider || "your utility",
    utility_bill: lead.utilityBill ?? "",
    solar_payment: lead.solarPayment ?? "",
    has_ev: lead.hasEV,
    has_pool: lead.hasPool,
    has_battery: lead.hasBattery,
  };
}

async function el(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "xi-api-key": elevenLabsConfig.apiKey,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

export interface OutboundCallResult {
  conversationId: string | null;
  callSid: string | null;
  success: boolean;
}

export interface ElevenLabsPhoneNumber {
  phone_number_id?: string;
  id?: string;
  phone_number?: string;
  label?: string;
}

/** List the phone numbers imported into the ElevenLabs account. */
export async function listPhoneNumbers(): Promise<ElevenLabsPhoneNumber[]> {
  const res = await el("/v1/convai/phone-numbers", { method: "GET" });
  const json = (await res.json().catch(() => [])) as unknown;
  if (Array.isArray(json)) return json as ElevenLabsPhoneNumber[];
  return ((json as { phone_numbers?: ElevenLabsPhoneNumber[] })?.phone_numbers ??
    []) as ElevenLabsPhoneNumber[];
}

let _cachedPhoneNumberId: string | null = null;

/**
 * Resolve the agent phone-number ID. Accepts EITHER the ElevenLabs phone number
 * ID (used as-is) OR a raw E.164 number — which we look up against the account's
 * imported numbers. This makes outbound calls work regardless of which value was
 * pasted into ELEVENLABS_AGENT_PHONE_NUMBER_ID (a common 404 source).
 */
export async function resolveAgentPhoneNumberId(): Promise<string> {
  const configured = elevenLabsConfig.agentPhoneNumberId.trim();
  const looksLikeNumber = /^\+?[\d\s().-]{7,}$/.test(configured);
  if (!looksLikeNumber) return configured; // already an ID (e.g. phnum_…)
  if (_cachedPhoneNumberId) return _cachedPhoneNumberId;
  try {
    const numbers = await listPhoneNumbers();
    const want = configured.replace(/\D/g, "");
    const match = numbers.find(
      (p) => (p.phone_number ?? "").replace(/\D/g, "") === want,
    );
    const id = match?.phone_number_id ?? match?.id;
    if (id) {
      _cachedPhoneNumberId = id;
      return id;
    }
  } catch {
    /* fall through to the configured value */
  }
  return configured;
}

/**
 * Place an outbound AI call via Twilio. `dynamicVariables` are injected into the
 * agent's prompt/script (e.g. first_name, utility_bill); `firstMessage` overrides
 * the agent's opening line for this call.
 */
export async function placeOutboundCall(opts: {
  toNumber: string;
  dynamicVariables?: Record<string, string | number | boolean>;
  firstMessage?: string;
}): Promise<OutboundCallResult> {
  const initData: Record<string, unknown> = {};
  if (opts.dynamicVariables) initData.dynamic_variables = opts.dynamicVariables;
  if (opts.firstMessage) {
    initData.conversation_config_override = {
      agent: { first_message: opts.firstMessage },
    };
  }

  const res = await el("/v1/convai/twilio/outbound-call", {
    method: "POST",
    body: JSON.stringify({
      agent_id: elevenLabsConfig.agentId,
      agent_phone_number_id: await resolveAgentPhoneNumberId(),
      to_number: opts.toNumber,
      ...(Object.keys(initData).length
        ? { conversation_initiation_client_data: initData }
        : {}),
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    conversationId:
      (json.conversation_id as string) ?? (json.conversationId as string) ?? null,
    callSid: (json.callSid as string) ?? (json.call_sid as string) ?? null,
    success: json.success !== false,
  };
}

export async function getConversation(id: string): Promise<unknown> {
  const res = await el(`/v1/convai/conversations/${encodeURIComponent(id)}`, {
    method: "GET",
  });
  return res.json();
}

/** Streams the recording audio for a completed conversation. */
export async function getConversationAudio(id: string): Promise<Response> {
  return el(`/v1/convai/conversations/${encodeURIComponent(id)}/audio`, {
    method: "GET",
    headers: { accept: "audio/mpeg" },
  });
}

/**
 * Verify the HMAC signature on a post-call webhook.
 * Header `elevenlabs-signature` looks like `t=<unix>,v0=<hex hmac>`, where the
 * HMAC is SHA-256 of `${t}.${rawBody}` keyed by the webhook secret.
 * When no secret is configured we accept (dev) but log nothing sensitive.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!elevenLabsConfig.webhookSecret) return true;
  if (!signatureHeader) return false;

  const parts: Record<string, string> = {};
  for (const segment of signatureHeader.split(",")) {
    const idx = segment.indexOf("=");
    if (idx > -1) {
      parts[segment.slice(0, idx).trim()] = segment.slice(idx + 1).trim();
    }
  }
  const t = parts.t;
  const v0 = parts.v0;
  if (!t || !v0) return false;

  const expected = crypto
    .createHmac("sha256", elevenLabsConfig.webhookSecret)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(v0), Buffer.from(expected));
  } catch {
    return false;
  }
}
