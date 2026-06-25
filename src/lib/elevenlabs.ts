import "server-only";

import crypto from "node:crypto";
import { currentDateContext } from "./ai/appointment";
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
  /** E.164 rep number the "Transfer" button reroutes a live call to. */
  transferNumber: process.env.ELEVENLABS_TRANSFER_NUMBER || "+14693018199",
  /**
   * A Twilio number we own whose Voice webhook points at /api/twilio/voice.
   * When set, AI calls are placed into a Twilio conference (the agent dials this
   * bridge, we move it into the room, then dial the homeowner in) so anyone can
   * listen live by joining the room muted — exactly like human calls, no relay.
   */
  bridgeNumber: process.env.TWILIO_AI_BRIDGE_NUMBER ?? "",
  /**
   * Dashboard-prompt mode. When true, the app does NOT override the agent's
   * prompt / first message / language / voice per call — it sends ONLY the
   * personalization variables and lets the agent run the script configured in
   * the ElevenLabs dashboard. Use this when you keep the script in ElevenLabs
   * (the "overrides" security toggles are OFF) instead of in the app.
   *
   * Why it matters: ElevenLabs TERMINATES the call the instant it receives a
   * conversation_config_override the agent isn't allowed to accept. So if the
   * overrides toggles are off but the app still sends a prompt override, the
   * call connects and then immediately ends. This flag must match the agent's
   * override settings: overrides ON → leave this false (app injects the script);
   * overrides OFF → set this true (agent uses its own dashboard script).
   */
  useDashboardPrompt: process.env.ELEVENLABS_USE_DASHBOARD_PROMPT === "true",
};

/** True when the AI agent can place outbound calls. */
export function isElevenLabsConfigured() {
  const c = elevenLabsConfig;
  return Boolean(c.apiKey && c.agentId && c.agentPhoneNumberId);
}

/**
 * True when AI calls can run through a Twilio conference for relay-free live
 * listening (a bridge number is configured). When false, calls go straight to
 * the homeowner as before and live listening falls back to the media relay.
 */
export function isAIBridgeConfigured() {
  return Boolean(elevenLabsConfig.bridgeNumber.trim());
}

/** The Twilio conference room name for an AI conversation (derived, stable). */
export function aiConferenceRoom(conversationId: string): string {
  return `ai-${conversationId}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

/**
 * Today's date variables, so the agent always knows what "today"/"tomorrow" mean
 * when scheduling and never books a guessed weekday. Computed in the homeowner's
 * timezone when known. Always sent (independent of lead match) so the prompt's
 * {{current_day}} / {{tomorrow_day}} tokens are never left empty.
 */
export function currentDateVariables(tz?: string): Record<string, string> {
  const dc = currentDateContext(new Date(), tz);
  return {
    current_date: dc.date,
    current_day: dc.day,
    current_time: dc.time,
    tomorrow_day: dc.tomorrowDay,
    tomorrow_date: dc.tomorrowDate,
  };
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
  opts?: { company?: string },
): Record<string, string | number | boolean> {
  const homeAddress =
    [lead.address, lead.city, lead.state].filter(Boolean).join(", ") +
    (lead.zip ? ` ${lead.zip}` : "");
  // The brand the agent introduces itself with = the CALLING organization (e.g.
  // "UNRG"), not the homeowner's installer. Falls back to the lead's solar
  // provider, then "Sunrun" for the demo. We expose it as {{company}} AND alias
  // {{solar_provider}} to it, so the agent only ever names the calling company —
  // and any prompt still using {{solar_provider}} keeps working unchanged.
  const brand =
    (opts?.company || "").trim() || lead.solarProvider?.trim() || "Sunrun";
  return {
    ...currentDateVariables(lead.timezone || undefined),
    customer_name: `${lead.firstName} ${lead.lastName}`.trim(),
    first_name: lead.firstName,
    last_name: lead.lastName,
    address: lead.address || lead.city || "your home",
    home_address: homeAddress || lead.city || "your home",
    city: lead.city,
    state: lead.state,
    company: brand,
    solar_provider: brand,
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
    // Never serve a cached conversation read — the live transcript must reflect
    // the call as it progresses, not a stale snapshot from an earlier poll.
    cache: "no-store",
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
  /** Full system prompt override (e.g. the Emily script) for this call. */
  promptOverride?: string;
  language?: string;
  /** TTS speed 0.7–1.2 (lower = slower/calmer). */
  voiceSpeed?: number;
}): Promise<OutboundCallResult> {
  const initData: Record<string, unknown> = {};
  if (opts.dynamicVariables) initData.dynamic_variables = opts.dynamicVariables;

  // Dashboard-prompt mode: send ONLY the personalization variables and let the
  // agent use its own configured prompt/first-message/voice. We must NOT send a
  // conversation_config_override the agent can't accept — that makes ElevenLabs
  // end the call on connect (the "it calls then immediately hangs up" symptom).
  if (!elevenLabsConfig.useDashboardPrompt) {
    const agent: Record<string, unknown> = {};
    if (opts.firstMessage) agent.first_message = opts.firstMessage;
    if (opts.promptOverride) agent.prompt = { prompt: opts.promptOverride };
    if (opts.language) agent.language = opts.language;
    const override: Record<string, unknown> = {};
    if (Object.keys(agent).length) override.agent = agent;
    if (typeof opts.voiceSpeed === "number") override.tts = { speed: opts.voiceSpeed };
    if (Object.keys(override).length) initData.conversation_config_override = override;
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

export interface ParsedConversation {
  status: string;
  callSid: string | null;
  durationSec: number | null;
  terminationReason: string;
  hasAudio: boolean;
  summary: string;
  turns: { role: string; message: string; secs: number | null }[];
}

/**
 * Fetch + normalize a conversation. One place to read the bits the monitor and
 * intervention logic need — status, the underlying Twilio CallSid (so a
 * supervisor can take over / hang up), duration, transcript, recording. Returns
 * null when the conversation can't be read yet (still ringing). Never throws.
 */
export async function fetchConversation(
  id: string,
): Promise<ParsedConversation | null> {
  try {
    const convo = (await getConversation(id)) as Record<string, unknown>;
    const data = (convo.data ?? convo) as Record<string, unknown>;
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const phone = (metadata.phone_call ??
      metadata.phone ??
      data.phone_call ??
      {}) as Record<string, unknown>;
    const callSid =
      String(
        phone.call_sid ??
          phone.callSid ??
          metadata.twilio_call_sid ??
          metadata.call_sid ??
          data.twilio_call_sid ??
          data.call_sid ??
          "",
      ) || null;
    const dur = Number(
      metadata.call_duration_secs ?? metadata.call_duration ?? NaN,
    );
    const analysis = (data.analysis ?? {}) as Record<string, unknown>;
    const turns = (Array.isArray(data.transcript) ? data.transcript : []).map(
      (t) => {
        const turn = t as Record<string, unknown>;
        const secs = Number(turn.time_in_call_secs ?? turn.time_in_call ?? NaN);
        return {
          role: String(turn.role ?? turn.speaker ?? "agent"),
          message: String(turn.message ?? turn.text ?? "").trim(),
          secs: Number.isFinite(secs) ? secs : null,
        };
      },
    );
    return {
      status: String(data.status ?? ""),
      callSid,
      durationSec: Number.isFinite(dur) ? dur : null,
      terminationReason: String(
        metadata.termination_reason ?? metadata.call_termination_reason ?? "",
      ),
      hasAudio: Boolean(data.has_audio),
      summary: String(analysis.transcript_summary ?? ""),
      turns,
    };
  } catch {
    return null;
  }
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
