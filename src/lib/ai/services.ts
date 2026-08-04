import "server-only";

import type { CallOutcome, Lead, MetricSummary } from "@/lib/types";
import { currentDateContext } from "./appointment";
import { generateJSON, runAI } from "./claude";
import {
  simulateBriefing,
  simulateConversationAnalysis,
  simulateCopilot,
  simulateReport,
  simulateSearch,
  simulateSummary,
} from "./simulate";
import type {
  AIResult,
  CallCopilot,
  CallSummary,
  ConversationAnalysis,
  ExecutiveReport,
  LeadBriefing,
  SemanticSearch,
} from "./types";

const OUTCOME_ENUM = {
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
} as const;

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

/**
 * The system prompt is org-vertical-aware: solar orgs get the solar-resolution
 * framing; every other vertical gets a generic sales-dialer framing so the
 * model never invents solar-specific content for leads that don't have any.
 */
function systemPrompt(isSolar: boolean): string {
  return isSolar
    ? "You are the embedded intelligence layer of AIATWORK, a solar resolution dialer. " +
        "Solar reps call homeowners who already have solar but still overpay their utility, " +
        "qualify them, and book no-cost account reviews. You are precise, commercially sharp, " +
        "and never invent facts beyond the data provided. Always respond with a single JSON " +
        "object that matches the requested schema — no prose, no markdown."
    : "You are the embedded intelligence layer of AIATWORK, an outbound sales resolution " +
        "dialer. Reps call leads, qualify them, and book appointments or account reviews. " +
        "You are precise, commercially sharp, and never invent facts beyond the data " +
        "provided — never assume or mention solar, utility bills, or energy costs unless " +
        "they're explicitly present in the lead data. Always respond with a single JSON " +
        "object that matches the requested schema — no prose, no markdown.";
}

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
export function getLeadBriefing(
  lead: Lead,
  isSolar = true,
): Promise<AIResult<LeadBriefing>> {
  return runAI(
    () =>
      generateJSON<LeadBriefing>({
        system: systemPrompt(isSolar),
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
export function getCallCopilot(
  lead: Lead,
  isSolar = true,
): Promise<AIResult<CallCopilot>> {
  return runAI(
    () =>
      generateJSON<CallCopilot>({
        system: systemPrompt(isSolar),
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
  isSolar = true,
): Promise<AIResult<CallSummary>> {
  return runAI(
    () =>
      generateJSON<CallSummary>({
        system: systemPrompt(isSolar),
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
  isSolar = true,
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
        system: systemPrompt(isSolar),
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

// ── Conversation analysis (ElevenLabs transcript → disposition + data) ───────
export function analyzeConversation(input: {
  transcript: string;
  lead?: Lead | null;
  /** Anchor for resolving "today"/"tomorrow"/weekday references in the call. */
  now?: Date;
  /** Homeowner's IANA timezone, when known. */
  tz?: string;
}): Promise<AIResult<ConversationAnalysis>> {
  const dc = currentDateContext(input.now ?? new Date(), input.tz);
  const dateLine =
    `IMPORTANT — today is ${dc.day}, ${dc.date} (local time ${dc.time}); ` +
    `tomorrow is ${dc.tomorrowDay}, ${dc.tomorrowDate}. When the homeowner agrees to a time, ` +
    `resolve every relative reference ("today", "tonight", "tomorrow", a weekday name, "in two days") ` +
    `to the ACTUAL calendar date and put an absolute, unambiguous value in appointment.when, ` +
    `formatted like "${dc.tomorrowDate.replace(/, \d{4}$/, "")} at 6:00 PM". ` +
    `Never output a bare relative word and never guess a weekday.`;
  return runAI(
    () =>
      generateJSON<ConversationAnalysis>({
        system: systemPrompt(true),
        prompt:
          "Analyze this completed AI sales call transcript carefully — base every field on what was " +
          "actually said, never on assumptions.\n" +
          "The transcript is labeled by speaker: lines starting with 'agent:' are the AI rep (Emily); " +
          "lines starting with 'user:' (or any non-agent label) are the HOMEOWNER.\n" +
          "CRITICAL disposition rules:\n" +
          "- Judge the disposition from the HOMEOWNER's words, NOT the agent's. The agent routinely says " +
          "'perfect', 'great', and 'you're all set' — those are her script, never evidence the homeowner " +
          "declined or agreed.\n" +
          "- appointment.requested = true ONLY if the homeowner accepted a SPECIFIC time (a weekday/date + " +
          "time), or the agent confirmed a specific time and the homeowner did not object. Merely OFFERING " +
          "a time is not enough.\n" +
          "- If an appointment was booked, outcome MUST be 'appointment_booked' — never 'qualified' or " +
          "'not_interested'. These must agree.\n" +
          "- Use 'not_interested' ONLY if the homeowner clearly refused the review. A homeowner who asks " +
          "skeptical questions (\"is this a scam?\", \"who are you?\") but still books is 'appointment_booked', " +
          "not negative. Refusing to answer ONE qualifying question is not a decline.\n" +
          "- 'do_not_call' only if they asked to stop being called / be removed.\n" +
          "- If the transcript shows a voicemail/answering-machine greeting (e.g. \"you've reached the " +
          "voicemail of…\", \"no one is available to take your call\", \"please leave a message after the " +
          "tone/beep\") and/or the agent leaving its own message with no live back-and-forth, outcome MUST " +
          "be 'voicemail' — never 'qualified', 'appointment_booked', or 'not_interested', no matter how " +
          "warm or specific the greeting sounds. This did not connect to a live person.\n" +
          "- Do NOT confuse an automated call-SCREENING prompt with voicemail. Some phones ask a short " +
          "question first — \"Who's calling?\", \"Say your name and reason for calling\", \"May I ask who's " +
          "calling?\" — before deciding whether to connect the call; that's a screener, not an answering " +
          "machine, even if the agent then answers it and nobody else speaks afterward. The tell: a real " +
          "voicemail greeting invites leaving a message after a tone/beep with no question asked; a " +
          "screener asks a question expecting an answer. If the agent answered a screening question (gave " +
          "her name/reason) rather than delivering the scripted voicemail message, do NOT mark this " +
          "'voicemail' just because the call ended without the homeowner speaking — treat it the same as " +
          "any other call that didn't connect to a live person (not a disposition on its own).\n" +
          "Also extract sentiment, qualification data (USD/month; use 0 when not stated), the exact agreed " +
          "time, and follow-ups.\n\n" +
          `${dateLine}\n\n` +
          (input.lead ? `Lead context: ${leadContext(input.lead)}\n\n` : "") +
          `Transcript:\n${input.transcript.slice(0, 8000)}`,
        schemaName: "conversation_analysis",
        effort: "medium",
        maxTokens: 1500,
        schema: obj({
          summary: str,
          detailedSummary: str,
          outcome: OUTCOME_ENUM,
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          qualification: obj({
            utilityBill: num,
            solarPayment: num,
            hasEV: { type: "boolean" },
            hasPool: { type: "boolean" },
            hasBattery: { type: "boolean" },
          }),
          appointment: obj({
            requested: { type: "boolean" },
            when: str,
            notes: str,
          }),
          followUps: strArr,
          confidence: num,
        }),
      }),
    () => simulateConversationAnalysis(input),
  );
}

// ── Executive reporting narrative ────────────────────────────────────────────
export function getExecutiveReport(
  metrics: MetricSummary,
  isSolar = true,
): Promise<AIResult<ExecutiveReport>> {
  return runAI(
    () =>
      generateJSON<ExecutiveReport>({
        system: systemPrompt(isSolar),
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
