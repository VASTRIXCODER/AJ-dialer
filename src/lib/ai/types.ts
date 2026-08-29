import type { CallOutcome } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared output shapes for the Claude-powered intelligence layer.
// Every AI service returns one of these typed structures so the UI can render
// consistent intelligence whether it came from Claude or the demo simulator.
// ─────────────────────────────────────────────────────────────────────────────

export type AISource = "claude" | "demo";

export interface AIResult<T> {
  data: T;
  source: AISource;
  /**
   * Why this fell back to the simulator, when it did. Present only on
   * `source: "demo"` — so a screen can say "Claude is unreachable: …" instead of
   * quietly showing invented numbers that look live.
   */
  error?: string;
}

/** A dynamic executive briefing generated the moment a lead is opened. */
export interface LeadBriefing {
  summary: string;
  priorityScore: number; // 0-100
  appointmentProbability: number; // 0-100
  contactProbability: number; // 0-100
  qualificationProbability: number; // 0-100
  estimatedValue: number; // USD opportunity
  personality: string;
  communicationStyle: string;
  objections: string[];
  painPoints: string[];
  openingLine: string;
  strategy: string;
  closingStrategy: string;
  bestCallback: string;
  confidence: number; // 0-100
}

/** Real-time copilot guidance surfaced during a live call. */
export interface CallCopilot {
  stage: string;
  nextQuestion: string;
  signals: Array<{ label: string; tone: "positive" | "neutral" | "negative" }>;
  objectionHandler: string;
  missingInfo: string[];
  coachingTip: string;
}

/** Multi-layer documentation generated after a completed interaction. */
export interface CallSummary {
  executiveSummary: string;
  detailedSummary: string;
  qualificationSummary: string;
  painPoints: string[];
  actionItems: string[];
  followUps: string[];
  riskFactors: string[];
  opportunity: string;
  recommendedOutcome: CallOutcome;
  confidence: number;
}

/**
 * The wrap-up copilot's disposition suggestion for a just-ended MANUAL call —
 * org-taxonomy aware (the key may be a custom `x_*` def), evidence = the rep's
 * notes + duration. Rendered as an actionable chip in the wrap-up panel; the
 * rep's click is what files it. Never auto-applies.
 */
export interface WrapupSuggestion {
  /** The disposition-def key to press (validated server-side; "" = none). */
  recommendedKey: string;
  /** The canonical outcome that key lands on. */
  recommendedOutcome: CallOutcome;
  /** The def's human label, resolved server-side with the org's vocabulary. */
  recommendedLabel: string;
  /** One short sentence of why — shown under the chip. */
  rationale: string;
  /** One-line factual recap of the call (NOT a persisted summary). */
  quickSummary: string;
  confidence: number;
}

export interface SemanticMatch {
  id: string;
  reason: string;
}

/** Natural-language search across the lead book. */
export interface SemanticSearch {
  interpretation: string;
  matches: SemanticMatch[];
}

export interface ReportRecommendation {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

/** An executive narrative that explains the numbers and what to do next. */
export interface ExecutiveReport {
  headline: string;
  narrative: string;
  trends: string[];
  risks: string[];
  opportunities: string[];
  recommendations: ReportRecommendation[];
}

/** Claude's structured read of a completed AI (ElevenLabs) conversation. */
export interface ConversationAnalysis {
  summary: string;
  detailedSummary: string;
  outcome: CallOutcome;
  sentiment: "positive" | "neutral" | "negative";
  /**
   * The solar core slots extracted from the call — present ONLY for
   * solar-template orgs. Non-solar analyses omit it entirely so the finalize
   * pipeline (enrichLeadFromAI) never writes solar fields onto their leads.
   */
  qualification?: {
    utilityBill: number | null;
    solarPayment: number | null;
    hasEV: boolean;
    hasPool: boolean;
    hasBattery: boolean;
  };
  appointment: { requested: boolean; when: string; notes: string };
  followUps: string[];
  confidence: number;
}
