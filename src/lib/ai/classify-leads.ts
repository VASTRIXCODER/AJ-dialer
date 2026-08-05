import "server-only";

import type { LeadGroupDef } from "@/lib/db/lead-groups";
import { classifyGeography } from "@/lib/leads/geography";
import { generateJSON, runAI } from "./claude";
import type { AIResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Lead sorting against an ORG'S OWN groups.
//
// Supersedes geo-classify.ts, which could only ever emit one of four hardcoded
// California/Texas metros. Here the taxonomy is data: whatever buckets the org
// created, described in their own words. The model is given each group's key,
// label and description and asked to place each lead — so improving a group's
// description directly improves that org's sorting, with no code change.
//
// Two guarantees are structural rather than prompt-wording, because prompt
// wording is not a guarantee:
//
//   1. 'manual'-kind groups are FILTERED OUT of the enum entirely, so the model
//      cannot assign a lead to a bucket that exists for humans to file by hand.
//      (The old geo classifier made the same promise the same way.)
//   2. The enum only contains keys that exist for this org, so a hallucinated
//      key can't be returned — and anything unrecognised is coerced to null on
//      the way out regardless.
//
// null means MISCELLANEOUS: the lead didn't clearly belong anywhere. That is a
// legitimate, common answer and the prompt asks for it over a guess — a wrongly
// filed lead is worse than an unfiled one, because nobody re-checks a lead that
// looks sorted.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassifyInputLead {
  tempId: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Extra signal for non-geographic groups (bill size, provider, source). */
  utilityProvider?: string;
  utilityBill?: number;
  solarPayment?: number;
}

export interface ClassifyOutcome {
  tempId: string;
  /** An org group key, or null for Miscellaneous. */
  group: string | null;
}

// Payload per lead is small, so 200 keeps each prompt and its JSON response
// within a bounded, reliable token budget. A 5,000-row sort is 25 chunks.
const CHUNK_SIZE = 200;
const CONCURRENCY = 4;

/** Groups the AI is allowed to assign — never the manual-kind ones. */
export function assignableGroups(groups: LeadGroupDef[]): LeadGroupDef[] {
  return groups.filter((g) => g.kind !== "manual");
}

function buildSystem(groups: LeadGroupDef[]): string {
  const lines = groups
    .map((g) => `- ${g.key}: ${g.label}${g.description ? ` — ${g.description}` : ""}`)
    .join("\n");
  return (
    "You sort sales leads into an organization's own named groups.\n\n" +
    `The ONLY valid group keys are:\n${lines}\n\n` +
    "Return the KEY (the part before the colon), never the label. If a lead " +
    "does not clearly belong to one of those groups — including leads with " +
    "missing or unusable data — return null. Prefer null over a guess: a lead " +
    "filed into the wrong group is worse than one left unsorted, because " +
    "nobody re-checks a lead that already looks sorted."
  );
}

function buildSchema(groups: LeadGroupDef[]) {
  return {
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
              enum: [...groups.map((g) => g.key), null],
            },
          },
          required: ["tempId", "group"],
        },
      },
    },
    required: ["results"],
  } as const;
}

function buildPrompt(chunk: ClassifyInputLead[]): string {
  const compact = chunk.map((l) => ({
    tempId: l.tempId,
    city: l.city ?? "",
    state: l.state ?? "",
    zip: l.zip ?? "",
    ...(l.utilityProvider ? { utilityProvider: l.utilityProvider } : {}),
    ...(l.utilityBill != null ? { utilityBill: l.utilityBill } : {}),
    ...(l.solarPayment != null ? { solarPayment: l.solarPayment } : {}),
  }));
  return `Leads:\n${JSON.stringify(compact)}`;
}

/**
 * Offline / failed-chunk fallback.
 *
 * The old geo taxonomy is still the best deterministic signal available, so a
 * lead is placed when the org kept a group whose key matches one the geography
 * classifier emits. An org with entirely custom groups gets null for the whole
 * chunk — honest Miscellaneous rather than an invented placement, and the UI
 * reports the sort as "demo" so nobody mistakes it for real classification.
 */
export function simulateClassification(
  leads: ClassifyInputLead[],
  groups: LeadGroupDef[],
): ClassifyOutcome[] {
  const available = new Set(groups.map((g) => g.key));
  return leads.map((l) => {
    const geo = classifyGeography({ city: l.city, state: l.state, zip: l.zip });
    return { tempId: l.tempId, group: geo && available.has(geo) ? geo : null };
  });
}

async function classifyChunk(
  chunk: ClassifyInputLead[],
  groups: LeadGroupDef[],
): Promise<ClassifyOutcome[]> {
  const { results } = await generateJSON<{ results: ClassifyOutcome[] }>({
    system: buildSystem(groups),
    prompt: buildPrompt(chunk),
    schema: buildSchema(groups) as unknown as Record<string, unknown>,
    schemaName: "lead_group_classification_batch",
    effort: "low",
    maxTokens: Math.min(4096, 200 + chunk.length * 20),
  });
  return results;
}

/**
 * Sort `leads` into `groups`. Each chunk catches its own failure and falls back
 * independently, so one bad batch costs that batch's quality and not the whole
 * import. Unknown keys coming back from the model are coerced to null.
 */
export async function classifyLeadsIntoGroups(
  leads: ClassifyInputLead[],
  allGroups: LeadGroupDef[],
): Promise<AIResult<ClassifyOutcome[]> & { chunkFailures: number }> {
  const groups = assignableGroups(allGroups);
  // Nothing to sort into — every lead is Miscellaneous by definition. Skip the
  // model entirely rather than sending it an empty enum.
  if (!groups.length) {
    return {
      data: leads.map((l) => ({ tempId: l.tempId, group: null })),
      source: "demo",
      chunkFailures: 0,
    };
  }

  const valid = new Set(groups.map((g) => g.key));
  let chunkFailures = 0;

  const result = await runAI(
    async () => {
      const chunks: ClassifyInputLead[][] = [];
      for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
        chunks.push(leads.slice(i, i + CHUNK_SIZE));
      }
      const out: ClassifyOutcome[] = [];
      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const wave = chunks.slice(i, i + CONCURRENCY);
        const settled = await Promise.all(
          wave.map((c) =>
            classifyChunk(c, groups).catch(() => {
              chunkFailures++;
              return simulateClassification(c, groups);
            }),
          ),
        );
        out.push(...settled.flat());
      }
      return out;
    },
    () => simulateClassification(leads, groups),
  );

  return {
    ...result,
    data: result.data.map((r) => ({
      tempId: r.tempId,
      group: r.group && valid.has(r.group) ? r.group : null,
    })),
    chunkFailures,
  };
}
