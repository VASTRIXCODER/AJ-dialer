import "server-only";

import { templateProfile } from "@/lib/org/templates";
import type { CallOutcome, Lead, MetricSummary } from "@/lib/types";
import { currentDateContext } from "./appointment";
import { generateJSON, runAI } from "./claude";
import {
  defaultAIContext,
  leadSchemaEntries,
  type OrgAIContext,
} from "./org-context";
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
 * The system prompt is org-vertical-aware. The solar template keeps the exact
 * solar-resolution framing; every other vertical gets the generic sales-dialer
 * framing (so the model never invents solar-specific content), enriched with
 * the template's blurb and the org's own noun for a contact.
 */
export function systemPrompt(ctx: OrgAIContext): string {
  if (ctx.isSolar) {
    return (
      "You are the embedded intelligence layer of AIATWORK, a solar resolution dialer. " +
      "Solar reps call homeowners who already have solar but still overpay their utility, " +
      "qualify them, and book no-cost account reviews. You are precise, commercially sharp, " +
      "and never invent facts beyond the data provided. Always respond with a single JSON " +
      "object that matches the requested schema — no prose, no markdown."
    );
  }
  const p = templateProfile(ctx.template);
  const vertical =
    ctx.template === "general"
      ? ""
      : ` This organization runs ${p.label.toLowerCase()} outreach — ` +
        `${p.blurb.replace(/\.\s*$/, "")} — and calls its contacts "${ctx.leadNounPlural}".`;
  return (
    "You are the embedded intelligence layer of AIATWORK, an outbound sales resolution " +
    `dialer. Reps call ${ctx.leadNounPlural}, qualify them, and book appointments or account reviews.` +
    vertical +
    " You are precise, commercially sharp, and never invent facts beyond the data " +
    "provided — never assume or mention solar, utility bills, or energy costs unless " +
    "they're explicitly present in the lead data. Always respond with a single JSON " +
    "object that matches the requested schema — no prose, no markdown."
  );
}

/**
 * Serialize a lead for a prompt: identity + the org's field schema (the org's
 * own labels, typed values, schema'd custom fields). Fields the org's template
 * hides never appear, so a non-solar prompt carries no solar vocabulary.
 */
export function leadContext(lead: Lead, ctx: OrgAIContext): string {
  const fields: Record<string, string | number | boolean | null> = {};
  for (const e of leadSchemaEntries(lead, ctx)) fields[e.label] = e.value;
  return JSON.stringify({
    name: `${lead.firstName} ${lead.lastName}`,
    city: lead.city,
    state: lead.state,
    status: lead.status,
    aiScore: lead.aiScore ?? null,
    notes: lead.notes ?? null,
    fields,
  });
}

// ── Lead intelligence briefing ───────────────────────────────────────────────
export function getLeadBriefing(
  lead: Lead,
  isSolar = true,
  ctx?: OrgAIContext,
): Promise<AIResult<LeadBriefing>> {
  const c = ctx ?? defaultAIContext(isSolar);
  return runAI(
    () =>
      generateJSON<LeadBriefing>({
        system: systemPrompt(c),
        prompt:
          `Produce an executive briefing for this ${c.leadNoun} before the rep dials. ` +
          "Scores are 0-100; estimatedValue is annual USD opportunity. Be specific to the data.\n\n" +
          `Lead: ${leadContext(lead, c)}`,
        schemaName: "lead_briefing",
        // A rep is looking at a spinner on the dial screen while this runs, so
        // latency IS the feature. Current models are strong at low effort on a
        // summarize-and-score task over structured data, and the measured
        // difference against `medium` here is seconds, not quality.
        effort: "low",
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
    () => simulateBriefing(lead, c),
  );
}

// ── Live call copilot ────────────────────────────────────────────────────────
export function getCallCopilot(
  lead: Lead,
  isSolar = true,
  /**
   * The conversation SO FAR ("role: message" lines). With it the copilot's
   * stage/signals describe the actual call; without it the model can only
   * reason from CRM fields, and the prompt says so instead of pretending.
   */
  transcript?: string,
  ctx?: OrgAIContext,
): Promise<AIResult<CallCopilot>> {
  const c = ctx ?? defaultAIContext(isSolar);
  return runAI(
    () =>
      generateJSON<CallCopilot>({
        system: systemPrompt(c),
        prompt:
          `The rep is mid-call with this ${c.leadNoun}. Act as a real-time sales copilot: ` +
          "track the stage, recommend the single next best question, surface live signals, " +
          "give one objection handler and one coaching tip, and list missing qualification info.\n" +
          (transcript
            ? "Base the stage and every signal on the live transcript below — what was " +
              "ACTUALLY said — not on assumptions about how such calls usually go.\n"
            : "No transcript is available: derive guidance from the lead data alone and " +
              "keep signals limited to what that data supports.\n") +
          `\nLead: ${leadContext(lead, c)}` +
          (transcript ? `\n\nLive transcript so far:\n${transcript.slice(0, 6000)}` : ""),
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
    () => simulateCopilot(lead, c),
  );
}

// ── Post-call documentation ──────────────────────────────────────────────────
export interface CallEvidence {
  /** "role: message" transcript lines, when the channel produced one. */
  transcript?: string;
  /** The rep's in-call notes — the real evidence a manual call leaves behind. */
  notes?: string;
  durationSec?: number;
}

export function getCallSummary(
  lead: Lead,
  outcome?: CallOutcome,
  isSolar = true,
  /**
   * What actually happened on the call. Without evidence the old prompt made
   * the model write confident "documentation" for a call it never saw; now it
   * is told exactly what it has and to keep anything beyond that minimal.
   */
  evidence?: CallEvidence,
  ctx?: OrgAIContext,
): Promise<AIResult<CallSummary>> {
  const c = ctx ?? defaultAIContext(isSolar);
  const evidenceBlock = [
    evidence?.durationSec != null ? `Call duration: ${evidence.durationSec}s.` : "",
    evidence?.notes?.trim() ? `Rep's in-call notes:\n${evidence.notes.trim().slice(0, 2000)}` : "",
    evidence?.transcript?.trim()
      ? `Transcript:\n${evidence.transcript.trim().slice(0, 8000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return runAI(
    () =>
      generateJSON<CallSummary>({
        system: systemPrompt(c),
        prompt:
          "Write structured documentation for the call that just ended. " +
          `${outcome ? `The rep dispositioned it as "${outcome}". ` : ""}` +
          "Base every statement on the evidence provided (disposition, duration, notes, " +
          "transcript). Where the evidence is thin, keep the documentation short and " +
          "factual — never invent quotes, objections, or events that are not in it. " +
          "recommendedOutcome must be one of: appointment_booked, callback_scheduled, qualified, " +
          "not_interested, no_answer, voicemail, wrong_number, do_not_call.\n\n" +
          `Lead: ${leadContext(lead, c)}` +
          (evidenceBlock ? `\n\n${evidenceBlock}` : "\n\nNo call evidence was captured beyond the disposition."),
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
    () => simulateSummary(lead, outcome, c),
  );
}

// ── Wrap-up disposition copilot (manual dialing) ─────────────────────────────

/** One wrap-up button the model may recommend (org taxonomy, resolved). */
export interface SuggestionOption {
  key: string;
  outcome: CallOutcome;
  label: string;
  description: string;
}

/**
 * Suggest which disposition button fits the call that just ended, from the
 * org's OWN wrap-up taxonomy (custom `x_*` rows included) — the AI-disposition
 * surface for manual dialing, where the only evidence is the rep's notes and
 * the duration. Deliberately tiny (effort low, four fields): it runs at every
 * manual wrap-up, so its cost profile matters. The rep's click files it —
 * this never writes anything.
 */
export function getWrapupSuggestion(
  lead: Lead,
  evidence: CallEvidence,
  options: SuggestionOption[],
  ctx?: OrgAIContext,
): Promise<
  AIResult<{
    recommendedKey: string;
    rationale: string;
    quickSummary: string;
    confidence: number;
  }>
> {
  const c = ctx ?? defaultAIContext(true);
  const menu = options
    .map((o) => `- ${o.key}: "${o.label}" (${o.description})`)
    .join("\n");
  const evidenceBlock = [
    evidence.durationSec != null ? `Call duration: ${evidence.durationSec}s.` : "",
    evidence.notes?.trim()
      ? `Rep's in-call notes:\n${evidence.notes.trim().slice(0, 2000)}`
      : "No notes were typed.",
  ]
    .filter(Boolean)
    .join("\n");
  return runAI(
    () =>
      generateJSON({
        system: systemPrompt(c),
        prompt:
          "A rep just ended a manual call and must pick ONE disposition button. " +
          "Recommend the button that best matches the evidence. recommendedKey MUST be " +
          "exactly one of the keys below (or \"\" if the evidence is too thin to call). " +
          "quickSummary is one factual sentence about the call; rationale is one short " +
          "sentence of why this button; confidence is your honest 0..1.\n\n" +
          `Buttons:\n${menu}\n\n` +
          `Lead: ${leadContext(lead, c)}\n\n${evidenceBlock}`,
        schemaName: "wrapup_suggestion",
        effort: "low",
        maxTokens: 400,
        schema: obj({
          recommendedKey: str,
          rationale: str,
          quickSummary: str,
          confidence: num,
        }),
      }),
    // Demo fallback: a transparent keyword heuristic over the same evidence —
    // never presented as a model read (source: "demo" rides the AIResult).
    () => {
      const notes = (evidence.notes ?? "").toLowerCase();
      const dur = evidence.durationSec ?? 0;
      const byOutcome = (o: CallOutcome) => options.find((x) => x.outcome === o);
      const pick =
        /appointment|booked|meeting|scheduled/.test(notes)
          ? byOutcome("appointment_booked")
          : /call.?back|call me|try again/.test(notes)
            ? byOutcome("callback_scheduled")
            : /not interested|no thanks|stop calling|remove/.test(notes)
              ? /stop calling|remove|do not call|dnc/.test(notes)
                ? (byOutcome("do_not_call") ?? byOutcome("not_interested"))
                : byOutcome("not_interested")
              : /voicemail|left a message/.test(notes)
                ? byOutcome("voicemail")
                : !notes && dur < 20
                  ? byOutcome("no_answer")
                  : dur >= 90
                    ? byOutcome("qualified")
                    : undefined;
      return {
        recommendedKey: pick?.key ?? "",
        rationale: pick
          ? "Keyword match on your notes (demo heuristic)."
          : "Not enough evidence for a suggestion.",
        quickSummary: notes
          ? "Call documented from the rep's notes."
          : `Call lasted ${Math.round(dur)}s with no notes captured.`,
        confidence: pick ? 0.4 : 0.1,
      };
    },
  );
}

// ── Natural-language lead search (stage 2: rerank retrieved candidates) ─────
export function getSemanticSearch(
  query: string,
  leads: Lead[],
  isSolar = true,
  ctx?: OrgAIContext,
): Promise<AIResult<SemanticSearch>> {
  const c = ctx ?? defaultAIContext(isSolar);
  // Callers pass a pre-retrieved candidate set (searchLeadCandidates caps at
  // 80); the slice stays as a safety ceiling on prompt size, not as the search.
  const compact = leads.slice(0, 80).map((l) => {
    const fields: Record<string, string | number | boolean> = {};
    for (const e of leadSchemaEntries(l, c)) {
      if (e.value != null) fields[e.label] = e.value;
    }
    return {
      id: l.id,
      name: `${l.firstName} ${l.lastName}`,
      city: l.city,
      state: l.state,
      status: l.status,
      ...fields,
    };
  });
  return runAI(
    () =>
      generateJSON<SemanticSearch>({
        system: systemPrompt(c),
        prompt:
          "You are RERANKING candidates already retrieved for the user's query — the list " +
          "below is the candidate set, not the whole book. Interpret the query and return " +
          `the ${c.leadNounPlural} that truly match it, best first (max 8). For each match give a ` +
          "short reason. Only return ids that exist in the candidate list.\n\n" +
          `Query: ${JSON.stringify(query)}\n\nCandidates: ${JSON.stringify(compact)}`,
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
    () => simulateSearch(query, leads, c),
  );
}

// ── Conversation analysis (ElevenLabs transcript → disposition + data) ───────
/**
 * Turn a completed AI-call transcript into a disposition + extracted data.
 *
 * Vertical-aware: the system prompt and wording follow the org's context (it
 * used to hardcode the solar framing for every tenant). The solar qualification
 * extraction (utility bill / solar payment / EV / pool / battery) runs ONLY for
 * solar-template orgs — those fields are solar's core slots, and the finalize
 * pipeline writes them back onto the lead. Non-solar orgs get the same schema
 * minus the qualification block, so `analysis.qualification` is undefined and
 * nothing solar is ever written back to their leads (gated here, at the source).
 */
export function analyzeConversation(input: {
  transcript: string;
  lead?: Lead | null;
  /** Anchor for resolving "today"/"tomorrow"/weekday references in the call. */
  now?: Date;
  /** Customer's IANA timezone, when known. */
  tz?: string;
  /** The calling org's AI context; omitted → the historical solar default. */
  ctx?: OrgAIContext;
}): Promise<AIResult<ConversationAnalysis>> {
  const c = input.ctx ?? defaultAIContext(true);
  const NOUN = c.leadNoun.toUpperCase();
  const dc = currentDateContext(input.now ?? new Date(), input.tz);
  const dateLine =
    `IMPORTANT — today is ${dc.day}, ${dc.date} (local time ${dc.time}); ` +
    `tomorrow is ${dc.tomorrowDay}, ${dc.tomorrowDate}. When the ${c.leadNoun} agrees to a time, ` +
    `resolve every relative reference ("today", "tonight", "tomorrow", a weekday name, "in two days") ` +
    `to the ACTUAL calendar date and put an absolute, unambiguous value in appointment.when, ` +
    `formatted like "${dc.tomorrowDate.replace(/, \d{4}$/, "")} at 6:00 PM". ` +
    `Never output a bare relative word and never guess a weekday.`;
  return runAI(
    () =>
      generateJSON<ConversationAnalysis>({
        system: systemPrompt(c),
        prompt:
          "Analyze this completed AI sales call transcript carefully — base every field on what was " +
          "actually said, never on assumptions.\n" +
          `The transcript is labeled by speaker: lines starting with 'agent:' are the AI rep; ` +
          `lines starting with 'user:' (or any non-agent label) are the ${NOUN}.\n` +
          "CRITICAL disposition rules:\n" +
          `- Judge the disposition from the ${NOUN}'s words, NOT the agent's. The agent routinely says ` +
          "'perfect', 'great', and 'you're all set' — those are her script, never evidence the customer " +
          "declined or agreed.\n" +
          `- appointment.requested = true ONLY if the ${c.leadNoun} accepted a SPECIFIC time (a weekday/date + ` +
          "time), or the agent confirmed a specific time and the customer did not object. Merely OFFERING " +
          "a time is not enough.\n" +
          "- If an appointment was booked, outcome MUST be 'appointment_booked' — never 'qualified' or " +
          "'not_interested'. These must agree.\n" +
          `- Use 'not_interested' ONLY if the ${c.leadNoun} clearly refused the review. A ${c.leadNoun} who asks ` +
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
          "'voicemail' just because the call ended without the customer speaking — treat it the same as " +
          "any other call that didn't connect to a live person (not a disposition on its own).\n" +
          (c.isSolar
            ? "Also extract sentiment, qualification data (USD/month; use 0 when not stated), the exact agreed " +
              "time, and follow-ups.\n\n"
            : "Also extract sentiment, the exact agreed time, and follow-ups.\n\n") +
          `${dateLine}\n\n` +
          (input.lead ? `Lead context: ${leadContext(input.lead, c)}\n\n` : "") +
          `Transcript:\n${input.transcript.slice(0, 8000)}`,
        schemaName: "conversation_analysis",
        effort: "medium",
        maxTokens: 1500,
        schema: obj({
          summary: str,
          detailedSummary: str,
          outcome: OUTCOME_ENUM,
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          // The solar qualification block is solar's core slots — extracted and
          // written back to the lead ONLY for solar-template orgs.
          ...(c.isSolar
            ? {
                qualification: obj({
                  utilityBill: num,
                  solarPayment: num,
                  hasEV: { type: "boolean" },
                  hasPool: { type: "boolean" },
                  hasBattery: { type: "boolean" },
                }),
              }
            : {}),
          appointment: obj({
            requested: { type: "boolean" },
            when: str,
            notes: str,
          }),
          followUps: strArr,
          confidence: num,
        }),
      }),
    () => simulateConversationAnalysis({ ...input, ctx: c }),
  );
}

// ── Executive reporting narrative ────────────────────────────────────────────
export function getExecutiveReport(
  metrics: MetricSummary,
  isSolar = true,
  ctx?: OrgAIContext,
): Promise<AIResult<ExecutiveReport>> {
  const c = ctx ?? defaultAIContext(isSolar);
  // MetricSummary carries solar-era aggregates (energy spend, EV/pool/battery
  // ownership). Serialize them only for solar orgs — for everyone else they're
  // another vertical's numbers and would drag the narrative back to solar.
  const serialized: Record<string, unknown> = { ...metrics };
  if (!c.isSolar) {
    delete serialized.avgUtilityBill;
    delete serialized.avgSolarPayment;
    delete serialized.avgTotalEnergyCost;
    delete serialized.evOwnership;
    delete serialized.poolOwnership;
    delete serialized.batteryOwnership;
  }
  return runAI(
    () =>
      generateJSON<ExecutiveReport>({
        system: systemPrompt(c),
        prompt:
          "Turn these floor metrics into an executive narrative for a sales manager: " +
          "explain what happened and why, surface trends, risks, and opportunities, and end " +
          "with prioritized recommendations.\n\n" +
          `Metrics: ${JSON.stringify(serialized)}`,
        schemaName: "executive_report",
        // Narrating a fixed metrics blob — the reasoning is shallow and the
        // Reports page holds a skeleton open while it runs.
        effort: "low",
        // The widest schema here (a headline, a narrative, three arrays and a
        // recommendation list). At the shared 2k default it truncated mid-array
        // and the whole report fell back to demo output.
        maxTokens: 3072,
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
    () => simulateReport(metrics, c),
  );
}
