import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { AIResult, AISource } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Centralized Claude reasoning engine.
//
// The entire AI layer routes through this module. When ANTHROPIC_API_KEY is set
// it calls Claude; otherwise — exactly like the Twilio integration — it degrades
// gracefully to deterministic simulation so the product is fully explorable in
// demo mode and never crashes without a key.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Claude model every AI surface uses. Overridable via the AI_MODEL env var so
 * the model can be changed or corrected without a code deploy (e.g. to roll
 * forward to a newer model, or roll back if one is unavailable) — the honest
 * health check (pingAI → /api/ai/health) shows immediately whether it resolves.
 *
 * Model IDs carry no date suffix; `claude-opus-5` is complete as written.
 */
export const AI_MODEL = process.env.AI_MODEL?.trim() || "claude-opus-5";

/**
 * Per-request ceiling. Anthropic's SDK defaults to a 10-minute timeout, which is
 * far longer than any hosting platform will hold a request open — a hung call
 * would burn the whole function budget and return nothing. Every surface here is
 * a small structured generation, so a minute is generous.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60_000);

/**
 * Headroom added to `max_tokens` when thinking is on. `max_tokens` caps thinking
 * AND the visible response together, so a budget sized for the JSON alone
 * truncates mid-object the moment the model thinks. Current models think by
 * default, so this is not an edge case.
 */
const THINKING_HEADROOM = 4096;

/** Non-streaming requests must stay well under the platform's HTTP timeout. */
const MAX_NONSTREAMING_TOKENS = 16_000;

/** True when Claude can be reached for live intelligence. */
export function isAIConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let _client: Anthropic | null = null;
function client() {
  if (!_client) {
    // Reads ANTHROPIC_API_KEY from env. maxRetries covers 429/5xx/connection
    // errors; the timeout keeps a wedged request from eating the whole budget.
    _client = new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
  }
  return _client;
}

type JSONSchema = Record<string, unknown>;
export type AIEffort = "low" | "medium" | "high" | "xhigh" | "max";

// ── Capability negotiation ───────────────────────────────────────────────────
// AI_MODEL is an env var, so the model in play is not knowable at build time: an
// operator can point this at an older snapshot, or at a model served by a
// provider that hasn't shipped a parameter yet. Rather than hard-fail every AI
// surface on one 400, we remember which advanced knobs THIS deployment's model
// rejected and stop sending them. The downgrade is one-way per process and
// logged once, so a misconfiguration is visible without being fatal.
const supported = { thinking: true, effort: true, format: true, fast: true };

/**
 * Fast mode runs the SAME model at a higher output-token rate — the right lever
 * here, because these surfaces are output-bound (a lead briefing is fifteen
 * fields the rep is staring at a spinner for). It is premium-priced, so it is
 * opt-in rather than a default someone discovers on an invoice.
 */
const FAST_MODE = /^(1|true|yes)$/i.test(process.env.AI_FAST_MODE ?? "");
const FAST_MODE_BETA = "fast-mode-2026-02-01";

/** Which knob a 400 is complaining about, if we can tell from its message. */
function unsupportedKnob(message: string): keyof typeof supported | null {
  const m = message.toLowerCase();
  if (m.includes("speed") || m.includes("fast-mode") || m.includes("fast mode"))
    return "fast";
  if (m.includes("thinking")) return "thinking";
  if (m.includes("effort")) return "effort";
  if (m.includes("format") || m.includes("json_schema") || m.includes("output_config"))
    return "format";
  return null;
}

function disable(knob: keyof typeof supported, why: string) {
  if (!supported[knob]) return;
  supported[knob] = false;
  console.warn(
    `[ai] ${AI_MODEL} rejected "${knob}" — disabling it for this process. (${why})`,
  );
}

interface CallOpts {
  system?: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  effort?: AIEffort;
  /** Structured-output schema. Omitted ⇒ free-form text. */
  format?: JSONSchema;
  /**
   * Let the model think before answering. Default true — and measurement says
   * leave it that way.
   *
   * Disabling it looks like the obvious latency lever and is not: with thinking
   * off, current models write their reasoning into the VISIBLE answer instead,
   * so the same lead briefing took longer (30s vs 22s) and the executive report
   * blew past its token ceiling mid-array and failed to parse. Effort is the
   * lever that actually works (medium → low roughly halved the briefing).
   *
   * Kept as an escape hatch for a future surface that is genuinely a lookup, and
   * as the record of why nothing sets it today.
   */
  think?: boolean;
  /**
   * Per-request timeout override, in ms. The client default (REQUEST_TIMEOUT_MS)
   * is sized for a background generation; a caller on a path a person is
   * actively waiting on — a rep watching an import progress line — should set a
   * tighter one and treat a timeout as "fall back", not "fail".
   */
  timeoutMs?: number;
}

/**
 * Guardrail for the no-thinking path. Without thinking, current models can write
 * internal XML into the visible answer. Naming the tags is measurably worse than
 * this generic form, and an instruction NOT to think makes the leak more likely
 * rather than less — so we say neither.
 */
const NO_INTERNAL_TAGS =
  "\n\nDo not include internal or system XML tags in your response.";

/**
 * One Claude call with graceful parameter degradation.
 *
 * Thinking is ON by default on current models and shares the `max_tokens`
 * budget with the visible answer, so the budget is padded here rather than at
 * every call site — a 2k-token JSON budget that used to be plenty now truncates
 * mid-object without it.
 */
async function callMessages(opts: CallOpts): Promise<Anthropic.Message> {
  const wantsThinking = opts.think !== false;
  const attempt = async (): Promise<Anthropic.Message> => {
    const thinkingOn = supported.thinking && wantsThinking;
    const max = Math.min(
      MAX_NONSTREAMING_TOKENS,
      thinkingOn ? opts.maxTokens + THINKING_HEADROOM : opts.maxTokens,
    );
    const params: Record<string, unknown> = {
      model: AI_MODEL,
      max_tokens: max,
      messages: opts.messages,
    };
    if (opts.system)
      params.system = thinkingOn ? opts.system : opts.system + NO_INTERNAL_TAGS;
    // Thinking is ON by default on current models, so this must be explicit in
    // BOTH directions — omitting the field does not mean "off".
    if (supported.thinking) {
      params.thinking = thinkingOn ? { type: "adaptive" } : { type: "disabled" };
    }
    const outputConfig: Record<string, unknown> = {};
    if (supported.effort && opts.effort) outputConfig.effort = opts.effort;
    // `output_config.format` takes exactly `{ type, schema }`. It used to be sent
    // with a `name` alongside them, which the API rejects outright:
    //   400 — output_config.format.name: Extra inputs are not permitted
    // Every structured generation therefore 400'd and was swallowed by runAI's
    // demo fallback, so a correctly-configured workspace with a valid key still
    // showed simulated briefings, summaries and reports — with no error anywhere
    // in the product to explain why.
    if (supported.format && opts.format) {
      outputConfig.format = { type: "json_schema", schema: opts.format };
    }
    if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;

    // Fast mode lives on the beta endpoint and needs its flag AND `speed` on the
    // body. Not every model or provider offers it, so a rejection just falls
    // back to standard speed rather than failing the surface.
    const requestOptions = opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined;
    if (FAST_MODE && supported.fast) {
      return client().beta.messages.create(
        {
          ...params,
          speed: "fast",
          betas: [FAST_MODE_BETA],
        } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
        requestOptions,
      ) as unknown as Promise<Anthropic.Message>;
    }
    return client().messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      requestOptions,
    );
  };

  try {
    return await attempt();
  } catch (err) {
    // A rejected fast mode is its own case: it's an optional accelerant, so
    // losing it must never take the surface down with it. An org without fast
    // mode enabled is refused with a 429 ("rate limit of 0 fast mode input
    // tokens per minute"), not a 400 — so a status-only check would have turned
    // AI_FAST_MODE=true into a total AI outage for exactly the orgs that can't
    // use it. Match on the message for the rate-limit case, and keep 400/404 for
    // models and providers that decline the beta outright.
    if (FAST_MODE && supported.fast) {
      const msg = err instanceof Error ? err.message : "";
      const fastRefused =
        err instanceof Anthropic.BadRequestError ||
        err instanceof Anthropic.NotFoundError ||
        (err instanceof Anthropic.RateLimitError && /fast[ -]?mode/i.test(msg));
      if (fastRefused) {
        disable("fast", msg.slice(0, 200));
        return attempt();
      }
    }
    // Only a 400 is a "this model doesn't take that parameter" signal. 401/403/
    // 429/5xx are real failures and must surface as-is.
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    const message = err.message ?? "";
    const knob = unsupportedKnob(message);
    if (knob && supported[knob]) {
      disable(knob, message.slice(0, 200));
      return attempt();
    }
    // An unattributable 400 while any advanced knob is still on: drop them all
    // and try the plainest possible request once before giving up.
    if (supported.thinking || supported.effort || supported.format) {
      disable("thinking", message.slice(0, 200));
      supported.effort = false;
      supported.format = false;
      return attempt();
    }
    throw err;
  }
}

/** Every text block, concatenated — a response may split across blocks. */
function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Turn a non-`end_turn` stop into a message a human can act on. Returns null
 * when the response finished normally.
 */
function stopProblem(res: Anthropic.Message): string | null {
  switch (res.stop_reason) {
    case "refusal":
      return `Claude declined this request${
        res.stop_details && "category" in res.stop_details && res.stop_details.category
          ? ` (${res.stop_details.category})`
          : ""
      }.`;
    case "max_tokens":
      return textOf(res)
        ? null // partial but parseable — let the caller try
        : "Claude hit the token ceiling before answering — raise max_tokens.";
    default:
      return null;
  }
}

/** Tolerantly pull a JSON object out of a model response (handles code fences). */
function extractJSON<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

/**
 * Ask Claude for a single structured JSON object. Uses structured outputs
 * (output_config.format) for reliability and instructs the model to emit JSON
 * so parsing is robust even on SDK versions that don't type the field.
 */
export async function generateJSON<T>(opts: {
  system: string;
  prompt: string;
  schema: JSONSchema;
  /** Human label for the shape. Kept for call-site readability; the API takes no name. */
  schemaName?: string;
  maxTokens?: number;
  effort?: AIEffort;
  /** See CallOpts.think — false only for surfaces a rep waits on mid-call. */
  think?: boolean;
  /** Fail fast instead of holding a request open — see CallOpts.timeoutMs. */
  timeoutMs?: number;
}): Promise<T> {
  const res = await callMessages({
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    maxTokens: opts.maxTokens ?? 2048,
    effort: opts.effort ?? "low",
    format: opts.schema,
    think: opts.think,
    timeoutMs: opts.timeoutMs,
  });
  const problem = stopProblem(res);
  if (problem) throw new Error(problem);
  return extractJSON<T>(textOf(res));
}

/**
 * JSON generation WITHOUT structured outputs — maximum compatibility. A plain
 * messages.create with a strict "JSON only" instruction, parsed tolerantly. Use
 * this when structured outputs aren't available or a call must not depend on the
 * exact output_config.format shape (which has drifted across API versions).
 */
export async function generateJSONLoose<T>(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Fail fast instead of holding a request open — see CallOpts.timeoutMs. */
  timeoutMs?: number;
}): Promise<T> {
  const res = await callMessages({
    system:
      opts.system +
      "\n\nRespond with ONLY a single valid JSON object — no prose, no explanation, " +
      "no markdown code fences, and no internal or system XML tags.",
    messages: [{ role: "user", content: opts.prompt }],
    maxTokens: opts.maxTokens ?? 2048,
    effort: "low",
    timeoutMs: opts.timeoutMs,
  });
  const problem = stopProblem(res);
  if (problem) throw new Error(problem);
  return extractJSON<T>(textOf(res));
}

export interface AIHealth {
  configured: boolean;
  ok: boolean;
  model?: string;
  reply?: string;
  /** How the model stopped — "end_turn" is the healthy case. */
  stopReason?: string;
  /** Round-trip latency of the probe, in ms. */
  latencyMs?: number;
  error?: string;
  /** Advanced parameters this deployment's model has rejected, if any. */
  degraded?: string[];
}

/**
 * Make a tiny real call to verify the Anthropic connection actually works
 * (key present AND reachable AND the model is accessible). Powers the health
 * check so misconfiguration is visible instead of silently degrading to demo.
 *
 * The token budget is generous on purpose: models that think by default spend
 * part of `max_tokens` before writing a word, and the previous 16-token ceiling
 * reported a perfectly healthy connection as a hard failure.
 */
export async function pingAI(): Promise<AIHealth> {
  if (!isAIConfigured()) {
    return {
      configured: false,
      ok: false,
      error: "ANTHROPIC_API_KEY is not set on the server.",
    };
  }
  // Read AFTER the probe: the probe itself is what discovers a knob this model
  // won't take, so sampling first would always report the previous state.
  const degradedNow = () =>
    Object.entries(supported)
      .filter(([, ok]) => !ok)
      .map(([knob]) => knob);
  const startedAt = Date.now();
  try {
    // Routed through callMessages so the probe exercises the SAME request path
    // the product uses — including fast mode when it's on. A probe that took a
    // simpler path could report a healthy connection while every real surface
    // was being refused.
    const res = await callMessages({
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
      maxTokens: 256,
    });
    const reply = textOf(res);
    const problem = stopProblem(res);
    return {
      configured: true,
      ok: Boolean(reply) && !problem,
      model: res.model,
      reply: reply || undefined,
      stopReason: res.stop_reason ?? undefined,
      latencyMs: Date.now() - startedAt,
      error: problem ?? (reply ? undefined : "Claude returned an empty response."),
      ...(degradedNow().length ? { degraded: degradedNow() } : {}),
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: describeAIError(e),
      ...(degradedNow().length ? { degraded: degradedNow() } : {}),
    };
  }
}

/**
 * A provider error rewritten as something an operator can act on. The raw SDK
 * message is kept on the end — it names the offending field — but the lead
 * sentence says what to actually do about it.
 */
export function describeAIError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (e instanceof Anthropic.AuthenticationError)
    return `ANTHROPIC_API_KEY was rejected. Check the key on the server. (${raw})`;
  if (e instanceof Anthropic.PermissionDeniedError)
    return `This API key can't access "${AI_MODEL}". Check the key's model access, or set AI_MODEL to one it can use. (${raw})`;
  if (e instanceof Anthropic.NotFoundError)
    return `Model "${AI_MODEL}" was not found. Check the AI_MODEL env var — model IDs take no date suffix. (${raw})`;
  if (e instanceof Anthropic.RateLimitError)
    return `Rate limited by Anthropic — the request will succeed on a retry. (${raw})`;
  if (e instanceof Anthropic.APIConnectionError)
    return `Couldn't reach the Anthropic API from this server. (${raw})`;
  return raw;
}

/**
 * Run an AI task with graceful degradation. Returns Claude output when
 * configured and successful; otherwise a deterministic simulated result, tagged
 * with its source so the UI can show whether intelligence is live.
 *
 * The failure reason rides along on `error` rather than living only in the
 * server log: "why is this workspace showing demo intelligence?" was previously
 * unanswerable from the product itself.
 */
export async function runAI<T>(
  task: () => Promise<T>,
  fallback: () => T,
): Promise<AIResult<T>> {
  if (!isAIConfigured())
    return {
      data: fallback(),
      source: "demo",
      error: "ANTHROPIC_API_KEY is not set on the server.",
    };
  try {
    return { data: await task(), source: "claude" };
  } catch (err) {
    const reason = describeAIError(err);
    console.error("[ai] Claude call failed — falling back to demo:", reason);
    return { data: fallback(), source: "demo", error: reason };
  }
}

/** A free-form chat turn (powers the AI command-center assistant). */
export async function chatComplete(opts: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  /** Fail fast instead of holding a request open — see CallOpts.timeoutMs. */
  timeoutMs?: number;
}): Promise<string> {
  const res = await callMessages({
    system: opts.system,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    maxTokens: opts.maxTokens ?? 1024,
    effort: "low",
    timeoutMs: opts.timeoutMs,
  });
  const problem = stopProblem(res);
  if (problem) throw new Error(problem);
  return textOf(res);
}

export type { AISource };
