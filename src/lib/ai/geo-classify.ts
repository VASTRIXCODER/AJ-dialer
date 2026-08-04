import "server-only";

import { regionsForPrompt } from "@/lib/leads/geography";
import { generateJSON, runAI } from "./claude";
import { simulateGeoClassification } from "./simulate";
import type { AIResult, GeoClassifyOutcome } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// AI-driven lead geography classification — the "dump & auto-sort" path.
//
// Kept separate from services.ts: every service there is a single generateJSON
// call, whereas classifying a whole CSV import needs chunking (a 5000-row batch
// as one prompt risks a huge, unreliable JSON response) and per-chunk fallback
// (one bad batch must not discard every other good one).
//
// The "manual" bucket is EXCLUDED at the schema level (the enum below has no
// "manual" member, and GeoClassifyOutcome.group is typed GeoLeadGroup | null,
// which structurally excludes it) — that is the load-bearing guarantee, not the
// prompt wording. Manual Dialing exists only for a human to file a lead into on
// purpose; the AI must never guess a lead belongs there.
// ─────────────────────────────────────────────────────────────────────────────

export interface GeoInputLead {
  tempId: string;
  city?: string;
  state?: string;
  zip?: string;
}

// Payload per lead is tiny (tempId + city + state + zip), so a chunk of 200
// keeps each prompt small and its JSON output (~200 short objects) reliably
// within a bounded token budget. A 5000-row import is 25 chunks / ~7 waves at
// this concurrency.
const CHUNK_SIZE = 200;
const CONCURRENCY = 4;

const SYSTEM =
  "You classify sales leads into ONE of four geographic buckets by " +
  "city/state/zip: fresno, houston, dallas, california. These are the ONLY " +
  "valid non-null outputs. There is a fifth bucket called \"manual\" that " +
  "exists in this product for leads a human explicitly files by hand — it is " +
  "NEVER a valid output for you, under any circumstance, even for a lead with " +
  "no location data at all. If a lead does not clearly belong to one of the " +
  "four listed regions — including leads outside all four regions, or leads " +
  "with missing/unusable location data — output null. Prefer null over a guess.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tempId: { type: "string" },
          group: {
            type: ["string", "null"],
            enum: ["fresno", "houston", "dallas", "california", null],
          },
        },
        required: ["tempId", "group"],
      },
    },
  },
  required: ["results"],
} as const;

function buildPrompt(chunk: GeoInputLead[]): string {
  const compact = chunk.map((l) => ({
    tempId: l.tempId,
    city: l.city ?? "",
    state: l.state ?? "",
    zip: l.zip ?? "",
  }));
  return `Regions:\n${regionsForPrompt()}\n\nLeads:\n${JSON.stringify(compact)}`;
}

async function classifyChunk(chunk: GeoInputLead[]): Promise<GeoClassifyOutcome[]> {
  const { results } = await generateJSON<{ results: GeoClassifyOutcome[] }>({
    system: SYSTEM,
    prompt: buildPrompt(chunk),
    schema: SCHEMA as unknown as Record<string, unknown>,
    schemaName: "geo_classification_batch",
    effort: "low",
    maxTokens: Math.min(4096, 200 + chunk.length * 20),
  });
  return results;
}

/**
 * Classify every lead's geography. Runs as one `runAI` task (the whole batch is
 * tagged "demo" only if AI is unconfigured, or if every chunk's Claude call
 * fails and there's nothing for `runAI` to catch — in practice each chunk
 * already falls back to the deterministic classifier below, so the overall
 * task itself essentially never throws). Each CHUNK independently catches its
 * own failure and falls back to `simulateGeoClassification` for just that
 * chunk, incrementing `chunkFailures` — because the deterministic classifier
 * uses the identical REGIONS taxonomy, mixing AI- and deterministically-
 * classified rows within one import carries no correctness risk, only a mild
 * quality difference for the affected rows.
 */
export async function classifyLeadsGeography(
  leads: GeoInputLead[],
): Promise<AIResult<GeoClassifyOutcome[]> & { chunkFailures: number }> {
  let chunkFailures = 0;
  const result = await runAI(
    async () => {
      const chunks: GeoInputLead[][] = [];
      for (let i = 0; i < leads.length; i += CHUNK_SIZE) chunks.push(leads.slice(i, i + CHUNK_SIZE));

      const out: GeoClassifyOutcome[] = [];
      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const wave = chunks.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          wave.map((c) =>
            classifyChunk(c).catch(() => {
              chunkFailures++;
              return simulateGeoClassification(c);
            }),
          ),
        );
        out.push(...results.flat());
      }
      return out;
    },
    () => simulateGeoClassification(leads),
  );
  return { ...result, chunkFailures };
}
