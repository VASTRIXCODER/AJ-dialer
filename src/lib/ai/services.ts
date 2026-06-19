import "server-only";

import type { CallOutcome, Lead, MetricSummary } from "@/lib/types";
import { generateJSON, runAI } from "./claude";
import {
  simulateBriefing,
  simulateCopilot,
  simulateReport,
  simulateSearch,
  simulateSummary,
} from "./simulate";
import type {
  AIResult,
  CallCopilot,
  CallSummary,
  ExecutiveReport,
  LeadBriefing,
  SemanticSearch,
} from "./types";

// ── schema helpers ───────────────────────────────────────────────────────────
const str = { type: "string" } as const;
const num = { type: "number" } as const;
const strArr = { type: "array", items: { type: "string" } } as const;
function obj(
  properties: Record<string, unknown>,
  required?: string[],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: required ?? Object.keys(properties),
  };
}

const SYSTEM =
  "You are the embedded intelligence layer of AIATWORK, a solar resolution dialer. " +
  "Solar reps call homeowners who already have solar but still overpay their utility, " +
  "qualify them, and book no-cost account reviews. You are precise, commercially sharp, " +
  "and never invent facts beyond the data provided. Always respond with a single JSON " +
  "object that matches the requested schema — no prose, no markdown.";

function leadContext(lead: Lead): string {
  return JSON.stringify({
    name: `${lead.firstName} ${lead.lastName}`,
    city: lead.city,
    state: lead.state,
    utilityProvider: lead.utilityProvider,
    solarProvider: lead.solarProvider,
    monthlyUtilityBill: lead.utilityBill ?? null,
    monthlySolarPayment: lead.solarPayment ?? null,
    hasEV: lead.hasEV,
    hasPool: lead.hasPool,
    hasBattery: lead.hasBattery,
    status: lead.status,
    aiScore: lead.aiScore ?? null,
    notes: lead.notes ?? null,
  });
}

// ── Lead intelligence briefing ───────────────────────────────────────────────
export function getLeadBriefing(lead: Lead): Promise<AIResult<LeadBriefing>> {
  return runAI(
    () =>
      generateJSON<LeadBriefing>({
        system: SYSTEM,
        prompt:
          "Produce an executive briefing for this homeowner before the rep dials. " +
          "Scores are 0-100; estimatedValue is annual USD opportunity. Be specific to the data.\n\n" +
          `Lead: ${leadContext(lead)}`,
        schemaName: "lead_briefing",
        effort: "medium",
        schema: obj({
          summary: str,
          priorityScore: num,
          appointmentProbability: num,
          contactProbability: num,
          qualificationProbability: num,
          estimatedValue: num,
          personality: str,
          communicationStyle: str,
          objections: strArr,
          painPoints: strArr,
          openingLine: str,
          strategy: str,
          closingStrategy: str,
          bestCallback: str,
          confidence: num,
        }),
      }),
    () => simulateBriefing(lead),
  );
}

// ── Live call copilot ────────────────────────────────────────────────────────
export function getCallCopilot(lead: Lead): Promise<AIResult<CallCopilot>> {
  return runAI(
    () =>
      generateJSON<CallCopilot>({
        system: SYSTEM,
        prompt:
          "The rep is mid-call with this homeowner. Act as a real-time sales copilot: " +
          "track the stage, recommend the single next best question, surface live signals, " +
          "give one objection handler and one coaching tip, and list missing qualification info.\n\n" +
          `Lead: ${leadContext(lead)}`,
        schemaName: "call_copilot",
        effort: "low",
        schema: obj({
          stage: str,
          nextQuestion: str,
          signals: {
            type: "array",
            items: obj({
              label: str,
              tone: { type: "string", enum: ["positive", "neutral", "negative"] },
            }),
          },
          objectionHandler: str,
          missingInfo: strArr,
          coachingTip: str,
        }),
      }),
    () => simulateCopilot(lead),
  );
}

// ── Post-call documentation ──────────────────────────────────────────────────
export function getCallSummary(
  lead: Lead,
  outcome?: CallOutcome,
): Promise<AIResult<CallSummary>> {
  return runAI(
    () =>
      generateJSON<CallSummary>({
        system: SYSTEM,
        prompt:
          "Write structured documentation for the call that just ended. " +
          `${outcome ? `The rep dispositioned it as "${outcome}". ` : ""}` +
          "recommendedOutcome must be one of: appointment_booked, callback_scheduled, qualified, " +
          "not_interested, no_answer, voicemail, wrong_number, do_not_call.\n\n" +
          `Lead: ${leadContext(lead)}`,
        schemaName: "call_summary",
        effort: "low",
        schema: obj({
          executiveSummary: str,
          detailedSummary: str,
          qualificationSummary: str,
          painPoints: strArr,
          actionItems: strArr,
          followUps: strArr,
          riskFactors: strArr,
          opportunity: str,
          recommendedOutcome: {
            type: "string",
            enum: [
              "appointment_booked",
              "callback_scheduled",
              "qualified",
              "not_interested",
              "no_answer",
              "voicemail",
              "wrong_number",
              "do_not_call",
            ],
          },
          confidence: num,
        }),
      }),
    () => simulateSummary(lead, outcome),
  );
}

// ── Natural-language lead search ─────────────────────────────────────────────
export function getSemanticSearch(
  query: string,
  leads: Lead[],
): Promise<AIResult<SemanticSearch>> {
  const compact = leads.slice(0, 80).map((l) => ({
    id: l.id,
    name: `${l.firstName} ${l.lastName}`,
    city: l.city,
    state: l.state,
    utility: l.utilityBill ?? null,
    solar: l.solarPayment ?? null,
    ev: l.hasEV,
    pool: l.hasPool,
    battery: l.hasBattery,
    status: l.status,
    provider: l.utilityProvider,
  }));
  return runAI(
    () =>
      generateJSON<SemanticSearch>({
        system: SYSTEM,
        prompt:
          "Interpret the user's natural-language query and return the matching homeowners " +
          "from the provided list, best first (max 8). For each match give a short reason. " +
          "Only return ids that exist in the list.\n\n" +
          `Query: ${JSON.stringify(query)}\n\nLeads: ${JSON.stringify(compact)}`,
        schemaName: "semantic_search",
        effort: "low",
        maxTokens: 1024,
        schema: obj({
          interpretation: str,
          matches: {
            type: "array",
            items: obj({ id: str, reason: str }),
          },
        }),
      }),
    () => simulateSearch(query, leads),
  );
}

// ── Executive reporting narrative ────────────────────────────────────────────
export function getExecutiveReport(
  metrics: MetricSummary,
): Promise<AIResult<ExecutiveReport>> {
  return runAI(
    () =>
      generateJSON<ExecutiveReport>({
        system: SYSTEM,
        prompt:
          "Turn these floor metrics into an executive narrative for a sales manager: " +
          "explain what happened and why, surface trends, risks, and opportunities, and end " +
          "with prioritized recommendations.\n\n" +
          `Metrics: ${JSON.stringify(metrics)}`,
        schemaName: "executive_report",
        effort: "medium",
        schema: obj({
          headline: str,
          narrative: str,
          trends: strArr,
          risks: strArr,
          opportunities: strArr,
          recommendations: {
            type: "array",
            items: obj({
              title: str,
              detail: str,
              priority: { type: "string", enum: ["high", "medium", "low"] },
            }),
          },
        }),
      }),
    () => simulateReport(metrics),
  );
}
