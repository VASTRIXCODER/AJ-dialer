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
 */
export const AI_MODEL = process.env.AI_MODEL || "claude-opus-4-8";

/** True when Claude can be reached for live intelligence. */
export function isAIConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return _client;
}

type JSONSchema = Record<string, unknown>;

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
  schemaName: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Fail fast instead of holding a request open — see generateJSONLoose. */
  timeoutMs?: number;
}): Promise<T> {
  const res = await client().messages.create(
    {
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      output_config: {
        effort: opts.effort ?? "low",
        format: {
          type: "json_schema",
          name: opts.schemaName,
          schema: opts.schema,
        },
      },
    } as Anthropic.MessageCreateParamsNonStreaming,
    opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
  );

  const block = res.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  return extractJSON<T>(block?.text ?? "");
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
  /**
   * Per-request timeout. The SDK's default is ten minutes, which is the right
   * default for a background job and the wrong one for anything a person is
   * waiting on — a call that hangs would hold the whole request open until the
   * platform killed it. Callers on a user-facing path should always set this and
   * treat a timeout as "fall back", not "fail".
   */
  timeoutMs?: number;
}): Promise<T> {
  const res = await client().messages.create(
    {
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      system:
        opts.system +
        "\n\nRespond with ONLY a single valid JSON object — no prose, no explanation, no markdown code fences.",
      messages: [{ role: "user", content: opts.prompt }],
    },
    opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
  );
  const block = res.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  return extractJSON<T>(block?.text ?? "");
}

/**
 * Make a tiny real call to verify the Anthropic connection actually works
 * (key present AND reachable AND the model is accessible). Powers the health
 * check so misconfiguration is visible instead of silently degrading to demo.
 */
export async function pingAI(): Promise<{
  configured: boolean;
  ok: boolean;
  model?: string;
  reply?: string;
  error?: string;
}> {
  if (!isAIConfigured()) {
    return { configured: false, ok: false, error: "ANTHROPIC_API_KEY is not set on the server." };
  }
  try {
    const res = await client().messages.create({
      model: AI_MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
    });
    const block = res.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const reply = block?.text?.trim();
    return { configured: true, ok: Boolean(reply), model: res.model, reply };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Run an AI task with graceful degradation. Returns Claude output when
 * configured and successful; otherwise a deterministic simulated result, tagged
 * with its source so the UI can show whether intelligence is live.
 */
export async function runAI<T>(
  task: () => Promise<T>,
  fallback: () => T,
): Promise<AIResult<T>> {
  if (!isAIConfigured()) return { data: fallback(), source: "demo" };
  try {
    return { data: await task(), source: "claude" };
  } catch (err) {
    console.error("[ai] Claude call failed — falling back to demo:", err);
    return { data: fallback(), source: "demo" };
  }
}

/** A free-form chat turn (powers the AI command-center assistant). */
export async function chatComplete(opts: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}): Promise<string> {
  const res = await client().messages.create({
    model: AI_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const block = res.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  return block?.text ?? "";
}

export type { AISource };
