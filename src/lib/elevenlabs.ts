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

/**
 * Which AI persona a call runs as. "primary" is the original (Emily) agent;
 * "secondary" is the optional second agent (its own ElevenLabs agent_id), which
 * a rep can pick in the dialer. Threaded from the dialer UI down to
 * `placeOutboundCall`. Falls back to "primary" everywhere the second agent isn't
 * configured, so the feature is inert until `ELEVENLABS_AGENT_ID_2` is set.
 */
export type AgentKey = "primary" | "secondary";

export const elevenLabsConfig = {
  apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  agentId: process.env.ELEVENLABS_AGENT_ID ?? "",
  agentPhoneNumberId: process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID ?? "",
  /** The optional second agent — a distinct ElevenLabs agent with its own script. */
  agentId2: process.env.ELEVENLABS_AGENT_ID_2 ?? "",
  /** Dedicated caller number for the second agent; falls back to the shared pool. */
  agentPhoneNumberId2: process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID_2 ?? "",
  /** Display labels for the dialer's agent picker (both personas are "Emily";
   *  these labels distinguish the two handling styles in the UI). */
  agentName: process.env.ELEVENLABS_AGENT_NAME || "Emily",
  agentName2: process.env.ELEVENLABS_AGENT_NAME_2 || "Emily (Sunrun)",
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

/** True when a distinct second agent is configured (drives the dialer's picker). */
export function isSecondAgentConfigured() {
  return Boolean(elevenLabsConfig.agentId2.trim());
}

/**
 * The display labels reps see in the dialer's agent picker and on the
 * appointments tabs. These are UI labels only — the name the AI actually says on
 * a call comes from org.settings.ai.agentName (the prompt), so relabeling here
 * never changes what a homeowner hears. "primary" is Agent 1 (the Emily agent);
 * "secondary" is Agent 2 (the Emily/Sunrun agent).
 */
export function agentLabels(): { primary: string; secondary: string } {
  return { primary: "Agent 1", secondary: "Agent 2" };
}

/** Map an internal agent key to its human label (Agent 1 / Agent 2). */
export function agentLabelFor(key: AgentKey | string | null | undefined): string {
  return key === "secondary" ? "Agent 2" : "Agent 1";
}

/**
 * Resolve the ElevenLabs identity to dial as. "secondary" gracefully degrades to
 * the primary agent when no second agent is configured, so a stale toggle value
 * can never place a call against an empty agent id.
 */
export function resolveElevenLabsAgent(key: AgentKey): {
  key: AgentKey;
  agentId: string;
  agentPhoneNumberId: string;
  name: string;
} {
  const c = elevenLabsConfig;
  if (key === "secondary" && c.agentId2.trim()) {
    return {
      key: "secondary",
      agentId: c.agentId2,
      // Fall back to the shared default number when the second agent has none.
      agentPhoneNumberId: c.agentPhoneNumberId2 || c.agentPhoneNumberId,
      name: c.agentName2,
    };
  }
  return {
    key: "primary",
    agentId: c.agentId,
    agentPhoneNumberId: c.agentPhoneNumberId,
    name: c.agentName,
  };
}

/** Map a raw ElevenLabs agent_id back to its key (used by the personalization webhook). */
export function agentKeyForId(agentId: string): AgentKey {
  const id = (agentId || "").trim();
  if (id && id === elevenLabsConfig.agentId2.trim()) return "secondary";
  return "primary";
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
    // This runs INLINE in page renders (reconcileOwnerActiveCalls, called at the
    // top of the dashboard/appointments/callbacks loaders) — a bare fetch() has
    // no default timeout, so one slow/unresponsive ElevenLabs call hangs the
    // request forever, which hangs the page forever for every single person
    // entering that org. Bound it so a provider hiccup fails fast instead.
    signal: AbortSignal.timeout(10_000),
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
  /** Override fields we were permitted to send on this call. */
  overridesSent: string[];
  /** Override fields we wanted but the agent forbids — omitted to keep the call alive. */
  overridesDropped: string[];
  /** Compact label persisted for forensics (e.g. "partial:first_message,language"). */
  overrideMode: string;
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

/**
 * Import a Twilio-owned number into ElevenLabs so it becomes eligible as an
 * agent_phone_number_id for outbound AI calls. ElevenLabs stores the Twilio
 * credentials itself in order to originate calls from this number.
 */
export async function importTwilioPhoneNumber(opts: {
  phoneNumber: string;
  label: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
}): Promise<string> {
  const res = await el("/v1/convai/phone-numbers", {
    method: "POST",
    body: JSON.stringify({
      phone_number: opts.phoneNumber,
      label: opts.label,
      sid: opts.twilioAccountSid,
      token: opts.twilioAuthToken,
      provider: "twilio",
    }),
  });
  const json = (await res.json()) as { phone_number_id?: string };
  if (!json.phone_number_id) {
    throw new Error("ElevenLabs import did not return a phone_number_id");
  }
  return json.phone_number_id;
}

const _phoneIdCache = new Map<string, string>();

/**
 * Resolve a phone identifier to an ElevenLabs phone_number_id. Accepts EITHER an
 * ElevenLabs ID (used as-is) OR a raw E.164 number — looked up against the
 * account's imported numbers and cached by digits. Returns "" when an E.164
 * number isn't imported, so rotation callers can fall back to the default number.
 */
export async function resolvePhoneNumberId(value: string): Promise<string> {
  const v = (value ?? "").trim();
  if (!v) return "";
  const looksLikeNumber = /^\+?[\d\s().-]{7,}$/.test(v);
  if (!looksLikeNumber) return v; // already an ID (e.g. phnum_…)
  const want = v.replace(/\D/g, "");
  const cached = _phoneIdCache.get(want);
  if (cached) return cached;
  try {
    const numbers = await listPhoneNumbers();
    const match = numbers.find(
      (p) => (p.phone_number ?? "").replace(/\D/g, "") === want,
    );
    const id = match?.phone_number_id ?? match?.id;
    if (id) {
      _phoneIdCache.set(want, id);
      return id;
    }
  } catch {
    /* fall through */
  }
  return "";
}

/**
 * Resolve the DEFAULT agent phone-number ID from env. Accepts an ID or a raw
 * E.164 number (a common 404 source), falling back to the raw configured value
 * if a lookup can't resolve it.
 */
export async function resolveAgentPhoneNumberId(): Promise<string> {
  const configured = elevenLabsConfig.agentPhoneNumberId.trim();
  return (await resolvePhoneNumberId(configured)) || configured;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE OVERRIDE CONTRACT  (this is what caused the zero-connect outage)
//
// ElevenLabs will TERMINATE a call the instant it receives a
// conversation_config_override for a field the agent hasn't allow-listed. The
// call connects, the homeowner says "hello", and it dies — ~2 seconds, no
// transcript. Every one of those was then filed as "no answer".
//
// The old code decided whether to send overrides purely from an env var
// (ELEVENLABS_USE_DASHBOARD_PROMPT). If that var and the agent's dashboard
// toggles ever disagreed, EVERY call died — and nothing anywhere said so.
//
// So we now ask the agent what it actually permits, and send only that.
// The rule is FAIL CLOSED: sending no override is always survivable (the agent
// falls back to its dashboard script and the call connects); sending a
// disallowed one is fatal. When we don't know the policy, we send nothing.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// QUOTA  (this is what actually caused the zero-connect outage)
//
// When the ElevenLabs credit balance is exhausted, the outbound call still gets
// PLACED — Twilio dials, the homeowner's phone rings, they pick up, the agent
// begins its greeting — and then ElevenLabs kills the conversation mid-sentence:
//
//     "This request exceeds your quota limit."
//     Status: Error · Duration: 0:02 · Cost: 0 credits
//
// Every one of those was then filed as "no answer". So an empty wallet looked
// exactly like a floor full of homeowners refusing to pick up, and the dialer
// happily burned through 1,500 real leads against a provider that could not
// speak a single word. Those leads are now marked "contacted" for nothing.
//
// The guardrail: CHECK BEFORE DIALING, and refuse. A lead you didn't call is
// recoverable; a lead you burned on a 2-second dead call is much less so.
// ─────────────────────────────────────────────────────────────────────────────

export interface QuotaStatus {
  /** Credits/characters consumed this period. */
  used: number;
  /** The period's allowance. */
  limit: number;
  remaining: number;
  /** True when there is no headroom left — DO NOT DIAL. */
  exhausted: boolean;
  /** True when we're close enough to the edge that a batch will run dry mid-way. */
  low: boolean;
  tier: string;
  /** ElevenLabs subscription status: active | trialing | past_due | free_disabled … */
  status: string;
  /** Can the account go into overage (usage-based billing)? If so, "exhausted" isn't fatal. */
  canOverage: boolean;
  /** When the allowance resets (ISO), if known. */
  resetsAt: string | null;
}

/** Below this many credits, a bulk batch will run dry partway through. */
const LOW_QUOTA_THRESHOLD = 500;

const QUOTA_TTL_MS = 60_000;
let _quotaCache: { value: QuotaStatus; expiresAt: number } | null = null;

/**
 * Read the account's remaining credits. Cached for a minute — a 1,500-call batch
 * must not make 1,500 billing lookups, but it must also notice within a minute
 * when the tank runs dry mid-batch.
 *
 * Returns null when it can't be read. Callers must treat null as "unknown" and
 * NOT block dialing on it — a billing-endpoint hiccup must never take the floor
 * down. The post-call quota detection (classifyNonConversation) is the backstop.
 */
export async function fetchQuota(opts: { force?: boolean } = {}): Promise<QuotaStatus | null> {
  if (!elevenLabsConfig.apiKey) return null;
  if (!opts.force && _quotaCache && _quotaCache.expiresAt > Date.now()) {
    return _quotaCache.value;
  }
  try {
    const res = await el("/v1/user/subscription", {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    const j = (await res.json()) as Record<string, unknown>;

    const used = Number(j.character_count ?? 0);
    const limit = Number(j.character_limit ?? 0);
    const remaining = Math.max(0, limit - used);
    // "unlimited" or a non-zero extension means the account can run into overage,
    // so hitting the limit doesn't actually stop calls.
    const ext = j.max_credit_limit_extension;
    const canOverage =
      Boolean(j.can_extend_character_limit) &&
      (ext === "unlimited" || Number(ext ?? 0) > 0);
    const status = String(j.status ?? "");
    const reset = Number(j.next_character_count_reset_unix ?? 0);

    const value: QuotaStatus = {
      used,
      limit,
      remaining,
      exhausted: !canOverage && limit > 0 && remaining <= 0,
      low: !canOverage && limit > 0 && remaining > 0 && remaining < LOW_QUOTA_THRESHOLD,
      tier: String(j.tier ?? ""),
      status,
      canOverage,
      resetsAt: reset > 0 ? new Date(reset * 1000).toISOString() : null,
    };
    _quotaCache = { value, expiresAt: Date.now() + QUOTA_TTL_MS };
    return value;
  } catch (e) {
    console.error("[elevenlabs] could not read quota", e);
    return null;
  }
}

/** Drop the cached quota — call after a quota failure so the next check is fresh. */
export function invalidateQuota(): void {
  _quotaCache = null;
}

/** Which override fields this agent has allow-listed in its Security settings. */
export interface OverridePolicy {
  prompt: boolean;
  firstMessage: boolean;
  language: boolean;
  ttsSpeed: boolean;
}

export const NO_OVERRIDES: OverridePolicy = {
  prompt: false,
  firstMessage: false,
  language: false,
  ttsSpeed: false,
};

const POLICY_TTL_MS = 5 * 60_000;
// Keyed by agent_id: each ElevenLabs agent has its OWN override allow-list, so a
// second agent must never reuse the first agent's policy (doing so could send it
// an override it doesn't allow, which kills the call the instant it connects).
const _policyCache = new Map<string, { value: OverridePolicy; expiresAt: number }>();
const _policyInFlight = new Map<string, Promise<OverridePolicy | null>>();

/**
 * Read the agent's allow-list: platform_settings.overrides.conversation_config_override.
 *
 * Cached (5 min) and single-flighted PER AGENT, so a burst of 1,500 dials makes ONE
 * request per distinct agent. Returns null on any failure — caller must then send no
 * overrides at all. Never throws: a hiccup reading the policy must never take the
 * dialer down. `agentId` defaults to the primary agent for existing callers.
 */
export async function fetchOverridePolicy(
  opts: { force?: boolean; agentId?: string } = {},
): Promise<OverridePolicy | null> {
  const agentId = (opts.agentId || elevenLabsConfig.agentId).trim();
  if (!elevenLabsConfig.apiKey || !agentId) return null;
  const now = Date.now();
  const cached = _policyCache.get(agentId);
  if (!opts.force && cached && cached.expiresAt > now) {
    return cached.value;
  }
  const inflight = _policyInFlight.get(agentId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const res = await el(
        `/v1/convai/agents/${encodeURIComponent(agentId)}`,
        { method: "GET", signal: AbortSignal.timeout(2500) },
      );
      const json = (await res.json()) as Record<string, unknown>;
      const platform = (json.platform_settings ?? {}) as Record<string, unknown>;
      const overrides = (platform.overrides ?? {}) as Record<string, unknown>;
      const cco = (overrides.conversation_config_override ?? {}) as Record<string, unknown>;
      const agent = (cco.agent ?? {}) as Record<string, unknown>;
      const tts = (cco.tts ?? {}) as Record<string, unknown>;
      const promptNode = (agent.prompt ?? {}) as Record<string, unknown> | boolean;

      const policy: OverridePolicy = {
        prompt:
          typeof promptNode === "boolean"
            ? promptNode
            : Boolean((promptNode as Record<string, unknown>).prompt),
        firstMessage: Boolean(agent.first_message),
        language: Boolean(agent.language),
        ttsSpeed: Boolean(tts.speed),
      };
      _policyCache.set(agentId, { value: policy, expiresAt: Date.now() + POLICY_TTL_MS });
      return policy;
    } catch (e) {
      console.error("[elevenlabs] could not read the agent's override policy — " +
        "sending NO overrides for safety (calls will use the dashboard script)", e);
      return null;
    } finally {
      _policyInFlight.delete(agentId);
    }
  })();

  _policyInFlight.set(agentId, promise);
  return promise;
}

/** The last policy we successfully read for an agent, without hitting the network. */
export function cachedOverridePolicy(agentId?: string): OverridePolicy | null {
  const id = (agentId || elevenLabsConfig.agentId).trim();
  const cached = _policyCache.get(id);
  return cached && cached.expiresAt > Date.now() ? cached.value : null;
}

export interface OverrideBuild {
  /** The conversation_config_override to send, or null to send none. */
  override: Record<string, unknown> | null;
  /** Fields we were asked for AND allowed to send. */
  sent: string[];
  /** Fields we were asked for but are NOT allowed to send — silently omitted. */
  dropped: string[];
  /** Compact label persisted on the conversation row for forensics. */
  mode: string;
}

/**
 * Build the override payload we are actually permitted to send.
 *
 * Pure — no I/O — so it can be unit-tested and reused by the health endpoint to
 * answer "would this call get killed right now?" without placing a call.
 *
 * `policy === null` (unknown) → send NOTHING. That is the fail-closed rule.
 */
export function buildOverridePayload(
  opts: {
    promptOverride?: string;
    firstMessage?: string;
    language?: string;
    voiceSpeed?: number;
  },
  policy: OverridePolicy | null,
): OverrideBuild {
  const wanted: { key: string; allowed: boolean; apply: (o: Record<string, unknown>) => void }[] = [];

  if (opts.promptOverride) {
    wanted.push({
      key: "prompt",
      allowed: Boolean(policy?.prompt),
      apply: (o) => {
        const agent = (o.agent ?? {}) as Record<string, unknown>;
        agent.prompt = { prompt: opts.promptOverride };
        o.agent = agent;
      },
    });
  }
  if (opts.firstMessage) {
    wanted.push({
      key: "first_message",
      allowed: Boolean(policy?.firstMessage),
      apply: (o) => {
        const agent = (o.agent ?? {}) as Record<string, unknown>;
        agent.first_message = opts.firstMessage;
        o.agent = agent;
      },
    });
  }
  if (opts.language) {
    wanted.push({
      key: "language",
      allowed: Boolean(policy?.language),
      apply: (o) => {
        const agent = (o.agent ?? {}) as Record<string, unknown>;
        agent.language = opts.language;
        o.agent = agent;
      },
    });
  }
  if (typeof opts.voiceSpeed === "number") {
    wanted.push({
      key: "tts.speed",
      allowed: Boolean(policy?.ttsSpeed),
      apply: (o) => {
        o.tts = { speed: opts.voiceSpeed };
      },
    });
  }

  const override: Record<string, unknown> = {};
  const sent: string[] = [];
  const dropped: string[] = [];
  for (const w of wanted) {
    if (w.allowed) {
      w.apply(override);
      sent.push(w.key);
    } else {
      dropped.push(w.key);
    }
  }

  if (dropped.length) {
    console.warn(
      "[elevenlabs] dropping override fields the agent does not allow — " +
        "sending them would kill the call on connect. Enable them under " +
        "Agent → Security → Overrides to use the app's script.",
      { dropped, sent, policyKnown: policy !== null },
    );
  }

  const mode = policy === null ? "none:policy-unknown" : sent.length ? `partial:${sent.join(",")}` : "none";
  return {
    override: Object.keys(override).length ? override : null,
    sent,
    dropped,
    mode,
  };
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
  /**
   * Outbound caller number for THIS call (rotation). An ElevenLabs phone-number
   * ID or a raw E.164 we resolve to one. Falls back to the env default number
   * when omitted or not importable into ElevenLabs.
   */
  agentPhoneNumberId?: string;
  /**
   * Which ElevenLabs agent to dial as. Defaults to the primary agent, so existing
   * callers are unchanged. The override policy is read for THIS agent.
   */
  agentId?: string;
}): Promise<OutboundCallResult> {
  const agentId = (opts.agentId || elevenLabsConfig.agentId).trim();
  const initData: Record<string, unknown> = {};
  if (opts.dynamicVariables) initData.dynamic_variables = opts.dynamicVariables;

  // Send ONLY the override fields this agent actually allows. `useDashboardPrompt`
  // is now just an explicit "never override" kill switch — it is no longer the
  // thing standing between us and a dead call, because the agent itself is the
  // authority on what it will accept.
  const policy = elevenLabsConfig.useDashboardPrompt
    ? NO_OVERRIDES
    : await fetchOverridePolicy({ agentId });
  const built = buildOverridePayload(opts, policy);
  if (built.override) initData.conversation_config_override = built.override;

  // Rotation: use the per-call number when it resolves to an imported ElevenLabs
  // number, otherwise fall back to the configured default.
  const agentPhoneNumberId =
    (opts.agentPhoneNumberId
      ? await resolvePhoneNumberId(opts.agentPhoneNumberId)
      : "") || (await resolveAgentPhoneNumberId());

  const res = await el("/v1/convai/twilio/outbound-call", {
    method: "POST",
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: agentPhoneNumberId,
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
    overridesSent: built.sent,
    overridesDropped: built.dropped,
    overrideMode: built.mode,
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
  /**
   * metadata.error — the provider telling us outright that IT failed (e.g. a
   * rejected conversation_config_override). This was previously parsed and
   * thrown away, which is a large part of why a total agent outage was invisible.
   */
  errorCode: string | null;
  errorReason: string;
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
    const err = (metadata.error ?? data.error ?? null) as
      | Record<string, unknown>
      | string
      | null;
    const errorCode =
      err == null
        ? null
        : typeof err === "string"
          ? err || null
          : String(err.code ?? err.type ?? "") || null;
    const errorReason =
      err == null || typeof err === "string"
        ? ""
        : String(err.reason ?? err.message ?? err.detail ?? "");

    return {
      status: String(data.status ?? ""),
      callSid,
      durationSec: Number.isFinite(dur) ? dur : null,
      terminationReason: String(
        metadata.termination_reason ?? metadata.call_termination_reason ?? "",
      ),
      errorCode,
      errorReason,
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
/** Max age (seconds) of a webhook timestamp before it's treated as a replay. */
const WEBHOOK_MAX_AGE_SEC = 30 * 60; // ElevenLabs' own recommended tolerance.

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  // Fail CLOSED when no secret is configured. This used to `return true`, so a
  // deployment that never set ELEVENLABS_WEBHOOK_SECRET accepted ANY payload — a
  // forger who knew a live conversation_id could rewrite its outcome/appointment.
  // A deployment that intentionally runs unsigned can opt back in with the env
  // valve; the reconcile cron still finalizes calls the webhook now rejects.
  if (!elevenLabsConfig.webhookSecret) {
    return process.env.ELEVENLABS_ALLOW_UNSIGNED_WEBHOOK === "true";
  }
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

  // Reject stale timestamps so a captured, validly-signed body can't be replayed
  // indefinitely. Generous window (30 min) so normal delivery + quick retries
  // pass; genuinely late retries are backstopped by the reconcile cron.
  const tsSec = Number(t);
  if (!Number.isFinite(tsSec)) return false;
  if (Math.abs(Date.now() / 1000 - tsSec) > WEBHOOK_MAX_AGE_SEC) return false;

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
