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

/** Always the latest, most capable Claude model. */
export const AI_MODEL = "claude-opus-4-8";

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
}): Promise<T> {
  const res = await client().messages.create({
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
  } as Anthropic.MessageCreateParamsNonStreaming);

  const block = res.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  return extractJSON<T>(block?.text ?? "");
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

export type { AISource };
