import "server-only";

import { humanAuthoredKinds, insertArtifacts, supersedeAIArtifacts } from "../db/call-artifacts";
import { mergeSettings } from "../org/settings";
import { publishOrgEvent } from "../realtime/publish";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import type { CallOutcome, Lead } from "../types";
import { AI_MODEL, generateJSON, isAIConfigured, runAI } from "./claude";
import { decideDispositionAction, type AiDispositionPolicy } from "./disposition-policy";
import { orgAIContext, type OrgAIContext } from "./org-context";
import {
  ANALYSIS_PROMPT_VERSION,
  ARTIFACT_KINDS,
  artifactEvidence,
  artifactPayload,
  buildAnalysisSchema,
  parseAnalysis,
  type CallAnalysis,
} from "./schemas";
import { leadContext, systemPrompt } from "./services";

// ─────────────────────────────────────────────────────────────────────────────
// analyzeCall — ONE structured pass over a finished call that replaces the old
// fire-and-forget free-form summary with typed, evidenced, provenance-carrying
// artifacts.
//
// What was wrong before: summaries were strings with no confidence, no
// evidence, no record of which model/prompt produced them, and no override
// history; a low-confidence AI disposition applied silently and looked exactly
// like a human's verdict.
//
// What this does instead, per call:
//   • one generateJSON over the combined schema (src/lib/ai/schemas.ts) —
//     every claim cites transcript turn indices;
//   • one call_artifacts row per kind (source 'ai', model, prompt_version,
//     confidence, evidence) — skipping any kind a human has since corrected
//     (an AI writer may NEVER supersede a human row);
//   • the disposition POLICY (org settings ai.dispositionPolicy): confident,
//     transcript-backed, benign proposals fill an EMPTY disposition slot;
//     everything else lands in call_review_queue + a review.created broadcast.
//
// Demo / no key / analyzer fallback: persist NOTHING. A simulated analysis in
// the artifact store would be indistinguishable from a real one forever.
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyzeTurn {
  role: string;
  message: string;
  secs?: number | null;
}

export interface AnalyzeCallInput {
  /** The AI conversation behind this record, when the call was AI-placed. */
  conversationId?: string | null;
  callRecordId: string;
  orgId: string;
  lead?: Lead | null;
  /** Structured turns (indices become the evidence space). Null = no transcript. */
  transcriptTurns?: AnalyzeTurn[] | null;
  /** The outcome as filed (null = un-dispositioned, e.g. an analyzer fallback). */
  outcome: CallOutcome | null;
  /** The rep's wrap-up notes — the main evidence a manual call leaves. */
  notes?: string;
  durationSec?: number;
  /**
   * Persist the summary artifact + backfill call_records.summary. Product
   * policy: AI summaries are appointment-only, so callers pass
   * `outcome === "appointment_booked"`. Default true (callers that predate
   * the policy keep their behavior); every other artifact kind always writes.
   */
  includeSummary?: boolean;
}

export interface AnalyzeCallResult {
  status: "persisted" | "skipped";
  reason?: string;
  /** What the disposition policy did (when a proposal was persisted). */
  dispositionAction?: "auto_applied" | "queued_for_review" | "none";
}

/** Cap the transcript we prompt with — indices stay REAL (a prefix, never a filter). */
const MAX_TURNS = 200;
const MAX_TRANSCRIPT_CHARS = 9_000;

/**
 * Number the turns so evidence indices are grounded: `[i] role: message`. The
 * prompt tells the model these bracketed indices ARE the evidence space.
 */
function numberedTranscript(turns: AnalyzeTurn[]): string {
  let out = "";
  for (let i = 0; i < turns.length; i++) {
    const line = `[${i}] ${turns[i].role}: ${turns[i].message.replace(/\s*\n+\s*/g, " ").trim()}\n`;
    if (out.length + line.length > MAX_TRANSCRIPT_CHARS) break;
    out += line;
  }
  return out.trimEnd();
}

function buildPrompt(input: {
  ctx: OrgAIContext;
  lead?: Lead | null;
  outcome: CallOutcome | null;
  notes?: string;
  durationSec?: number;
  transcript: string;
  turnCount: number;
}): string {
  const { ctx } = input;
  const evidenceRules = input.turnCount
    ? "EVIDENCE RULES (critical):\n" +
      `- The transcript below numbers each turn as [index]. Every evidence array MUST ` +
      `contain only these integer indices (0 to ${input.turnCount - 1}) — the turns that ` +
      "directly support the claim.\n" +
      "- Never cite an index that does not exist, and never invent quotes, objections, " +
      "commitments, or events that are not in the transcript. A claim you cannot point " +
      "at a turn for does not belong in the output.\n" +
      "- Where the evidence is thin, keep the extraction short and factual and lower the " +
      "kind's confidence rather than filling gaps.\n"
    : "There is NO transcript for this call. Base every statement on the disposition, " +
      "duration and notes provided — keep every extraction short and factual, use EMPTY " +
      "evidence arrays throughout, and keep confidence low. Never invent quotes, " +
      "objections, or commitments; if a section has nothing supportable, return an " +
      "empty items list.\n";
  return (
    "Extract structured intelligence from the call that just ended. Fill every section " +
    "of the schema:\n" +
    "- summary: 2-4 sentences of what actually happened, plus keyPoints.\n" +
    `- facts: concrete things learned about the ${ctx.leadNoun} (label + value).\n` +
    "- objections: what they pushed back on, and how (if at all) it was answered.\n" +
    "- commitments: who agreed to do what, and when, on either side of the call.\n" +
    "- appointment_signals: whether a meeting was agreed, and the exact words for when.\n" +
    "- compliance_flags: anything a compliance reviewer should see (a do-not-call " +
    "request, a recording objection, misleading claims, abusive exchange). Empty when clean.\n" +
    "- proposed_disposition: the disposition KEY this call should be filed under, with " +
    "your rationale. key and outcome must be one of: appointment_booked, " +
    "callback_scheduled, qualified, not_interested, bills_fine, no_answer, voicemail, " +
    "wrong_number, do_not_call.\n" +
    "Every section carries confidence 0..1 — your honest probability that the section is " +
    "correct and complete. Use \"\" for an optional string you have nothing for.\n\n" +
    evidenceRules +
    "\n" +
    (input.outcome ? `The call was dispositioned as "${input.outcome}".\n` : "The call has not been dispositioned yet.\n") +
    (input.durationSec != null ? `Call duration: ${Math.max(0, Math.round(input.durationSec))}s.\n` : "") +
    (input.notes?.trim() ? `\nRep's in-call notes:\n${input.notes.trim().slice(0, 2000)}\n` : "") +
    (input.lead ? `\nLead context: ${leadContext(input.lead, ctx)}\n` : "") +
    (input.transcript ? `\nTranscript:\n${input.transcript}` : "")
  );
}

/** Load the org's AI context + disposition policy (service-role; webhook-safe). */
async function loadOrgPolicy(
  orgId: string,
): Promise<{ ctx: OrgAIContext; policy: AiDispositionPolicy } | null> {
  try {
    const { data: org } = await createAdminClient()
      .from("organizations")
      .select("dialer_template, settings")
      .eq("id", orgId)
      .maybeSingle();
    if (!org) return null;
    const settings = mergeSettings(org.settings);
    return {
      ctx: orgAIContext({
        dialerTemplate: String(org.dialer_template ?? "general"),
        settings,
      }),
      policy: settings.ai.dispositionPolicy,
    };
  } catch {
    return null;
  }
}

export async function analyzeCall(input: AnalyzeCallInput): Promise<AnalyzeCallResult> {
  try {
    // Demo mode persists NOTHING: no key → no artifacts, no review rows. The
    // simulator exists for screens, not for the permanent record.
    if (!isAdminConfigured()) return { status: "skipped", reason: "no_database" };
    if (!isAIConfigured()) return { status: "skipped", reason: "ai_unconfigured" };

    const loaded = await loadOrgPolicy(input.orgId);
    if (!loaded) return { status: "skipped", reason: "org_not_found" };
    const { ctx, policy } = loaded;

    const turns = (input.transcriptTurns ?? [])
      .filter((t) => (t.message ?? "").trim().length > 0)
      .slice(0, MAX_TURNS);
    const hasTranscript = turns.length > 0;

    const result = await runAI<CallAnalysis | null>(
      async () => {
        const raw = await generateJSON<unknown>({
          system: systemPrompt(ctx),
          prompt: buildPrompt({
            ctx,
            lead: input.lead,
            outcome: input.outcome,
            notes: input.notes,
            durationSec: input.durationSec,
            transcript: hasTranscript ? numberedTranscript(turns) : "",
            turnCount: turns.length,
          }),
          schemaName: "call_analysis",
          schema: buildAnalysisSchema(),
          effort: "medium",
          // The widest schema in the product — seven sections with item lists.
          maxTokens: 4096,
        });
        return parseAnalysis(raw, hasTranscript ? turns.length : undefined);
      },
      // The fallback is null on purpose — a simulated analysis must never be
      // persisted as if the model read the call.
      () => null,
    );
    if (result.source !== "claude" || result.data == null) {
      return { status: "skipped", reason: result.error ?? "analysis_unavailable" };
    }
    const analysis = result.data;

    const admin = createAdminClient();

    // ── Override chain: a human's corrections are final against AI writers ───
    const blocked = await humanAuthoredKinds(input.callRecordId);
    const includeSummary = input.includeSummary !== false;
    const writableKinds = ARTIFACT_KINDS.filter(
      (k) => !blocked.has(k) && (includeSummary || k !== "summary"),
    );
    if (writableKinds.length === 0) {
      return { status: "skipped", reason: "all_kinds_human_authored" };
    }

    // A re-analysis replaces its OWN earlier output (chained), never a human's.
    const chained = await supersedeAIArtifacts(input.callRecordId, [...writableKinds]);

    await insertArtifacts(
      writableKinds.map((kind) => {
        const { payload, confidence } = artifactPayload(kind, analysis);
        return {
          orgId: input.orgId,
          callRecordId: input.callRecordId,
          conversationId: input.conversationId ?? null,
          kind,
          payload,
          confidence,
          evidence: artifactEvidence(kind, analysis),
          model: AI_MODEL,
          promptVersion: ANALYSIS_PROMPT_VERSION,
          source: "ai" as const,
          supersedes: chained.get(kind) ?? null,
        };
      }),
    );

    // ── Read the record as it stands (disposition slot + summary backfill) ────
    const { data: rec } = await admin
      .from("call_records")
      .select("id, disposition, summary")
      .eq("id", input.callRecordId)
      .maybeSingle();
    const currentDisposition =
      rec?.disposition != null && String(rec.disposition).length > 0
        ? String(rec.disposition)
        : null;

    // The summary artifact's text backfills call_records.summary so the archive
    // can SEARCH it — but only into an empty slot (an existing summary, human
    // or earlier-AI, is a record we don't rewrite from a background job), and
    // only when this call is one that gets a summary at all (appointment-only).
    if (
      includeSummary &&
      rec &&
      !String(rec.summary ?? "").trim() &&
      analysis.summary.text.trim()
    ) {
      await admin
        .from("call_records")
        .update({ summary: analysis.summary.text })
        .eq("id", input.callRecordId);
    }

    // ── Disposition policy ────────────────────────────────────────────────────
    // If a human has taken over the proposed_disposition artifact itself, the
    // AI has no standing to act on the record at all.
    if (blocked.has("proposed_disposition")) {
      return { status: "persisted", dispositionAction: "none" };
    }
    const pd = analysis.proposed_disposition;
    const decision = decideDispositionAction({
      confidence: pd.confidence,
      outcome: pd.outcome,
      proposedKey: pd.key,
      hasTranscript,
      currentDisposition,
      policy,
    });

    if (decision.action === "auto_apply") {
      // Fill the EMPTY slot only — the `is null` guard makes a racing human
      // write win, always. Deliberately does NOT touch `outcome` or run
      // pipeline routing: auto-apply is documentation-grade (the key on the
      // record), never a silent pipeline mutation.
      await admin
        .from("call_records")
        .update({ disposition: pd.key })
        .eq("id", input.callRecordId)
        .is("disposition", null);
      return { status: "persisted", dispositionAction: "auto_applied" };
    }

    if (decision.action === "review") {
      // One open review per record: replays (webhook + reconciler, outbox
      // retries) must not stack duplicate rows in front of a supervisor.
      const { data: existing } = await admin
        .from("call_review_queue")
        .select("id")
        .eq("call_record_id", input.callRecordId)
        .eq("status", "open")
        .maybeSingle();
      if (!existing) {
        const { data: row } = await admin
          .from("call_review_queue")
          .insert({
            org_id: input.orgId,
            call_record_id: input.callRecordId,
            reason: decision.reason,
            proposed_disposition: pd.key,
            confidence: pd.confidence,
            status: "open",
          })
          .select("id")
          .maybeSingle();
        publishOrgEvent(input.orgId, "review.created", {
          reviewId: row?.id ? String(row.id) : undefined,
          conversationId: input.conversationId ?? null,
          callRecordId: input.callRecordId,
          reason: decision.reason,
        });
      }
      return { status: "persisted", dispositionAction: "queued_for_review" };
    }

    return { status: "persisted", dispositionAction: "none" };
  } catch (e) {
    // Post-call intelligence must never take a webhook or a disposition save
    // down with it.
    console.error(
      "[analyze-call] failed:",
      e instanceof Error ? e.message : e,
    );
    return { status: "skipped", reason: "error" };
  }
}
