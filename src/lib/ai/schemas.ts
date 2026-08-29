// ─────────────────────────────────────────────────────────────────────────────
// Structured call-intelligence schemas — PURE module (no server-only, no I/O).
//
// One combined generateJSON call produces every artifact kind for a call, each
// carrying its own confidence and EVIDENCE (transcript turn indices), so a
// claim in the UI can always answer "where in the call does it say that?".
// parseAnalysis() is the strict gate between the model and the database: shape
// drift rejects to null (never throws), out-of-range evidence indices are
// dropped, confidence is clamped into [0, 1]. Nothing un-validated is ever
// persisted as an artifact.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome } from "../types";

/** Stamped onto every artifact row this schema version produces. */
export const ANALYSIS_PROMPT_VERSION = "p1-f1";

/** The artifact kinds ONE analysis pass writes (call_artifacts.kind values). */
export const ARTIFACT_KINDS = [
  "summary",
  "facts",
  "objections",
  "commitments",
  "appointment_signals",
  "compliance_flags",
  "proposed_disposition",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * The nine stored outcome keys, in lockstep with `CallOutcome` in types.ts —
 * typed against it so a future outcome can't be forgotten here silently.
 */
export const CALL_OUTCOME_KEYS: readonly CallOutcome[] = [
  "appointment_booked",
  "callback_scheduled",
  "qualified",
  "not_interested",
  "bills_fine",
  "no_answer",
  "voicemail",
  "wrong_number",
  "do_not_call",
];

// ── Artifact payload shapes (what call_artifacts.payload holds, per kind) ────

export interface SummaryArtifact {
  confidence: number;
  text: string;
  keyPoints: string[];
}

export interface FactItem {
  label: string;
  value: string;
  evidence: number[];
}
export interface FactsArtifact {
  confidence: number;
  items: FactItem[];
}

export interface ObjectionItem {
  objection: string;
  response?: string;
  evidence: number[];
}
export interface ObjectionsArtifact {
  confidence: number;
  items: ObjectionItem[];
}

export interface CommitmentItem {
  who: string;
  what: string;
  when?: string;
  evidence: number[];
}
export interface CommitmentsArtifact {
  confidence: number;
  items: CommitmentItem[];
}

export interface AppointmentSignalsArtifact {
  confidence: number;
  present: boolean;
  when?: string;
  evidence: number[];
}

export interface ComplianceFlagItem {
  kind: string;
  note: string;
  evidence: number[];
}
export interface ComplianceFlagsArtifact {
  confidence: number;
  items: ComplianceFlagItem[];
}

export interface ProposedDispositionArtifact {
  confidence: number;
  /** The disposition KEY to file — one of the nine canonical stored keys. */
  key: string;
  outcome: CallOutcome;
  rationale: string;
  evidence: number[];
}

/** Everything one analysis pass extracts, keyed by artifact kind. */
export interface CallAnalysis {
  summary: SummaryArtifact;
  facts: FactsArtifact;
  objections: ObjectionsArtifact;
  commitments: CommitmentsArtifact;
  appointment_signals: AppointmentSignalsArtifact;
  compliance_flags: ComplianceFlagsArtifact;
  proposed_disposition: ProposedDispositionArtifact;
}

// ── JSON schema (the shape sent to output_config.format — {type, schema} only,
//    never a name; see src/lib/ai/claude.ts on why a name 400s) ───────────────

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const bool = { type: "boolean" } as const;
const strArr = { type: "array", items: { type: "string" } } as const;
const intArr = { type: "array", items: { type: "integer" } } as const;

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
 * The one combined schema for the whole analysis. Optional fields (an
 * objection's response, a commitment's when) are REQUIRED in the schema —
 * structured outputs are far more reliable with a total shape — and the model
 * is told to send "" for "none"; parseAnalysis maps empty strings back to
 * undefined.
 */
export function buildAnalysisSchema(): Record<string, unknown> {
  return obj({
    summary: obj({ confidence: num, text: str, keyPoints: strArr }),
    facts: obj({
      confidence: num,
      items: {
        type: "array",
        items: obj({ label: str, value: str, evidence: intArr }),
      },
    }),
    objections: obj({
      confidence: num,
      items: {
        type: "array",
        items: obj({ objection: str, response: str, evidence: intArr }),
      },
    }),
    commitments: obj({
      confidence: num,
      items: {
        type: "array",
        items: obj({ who: str, what: str, when: str, evidence: intArr }),
      },
    }),
    appointment_signals: obj({
      confidence: num,
      present: bool,
      when: str,
      evidence: intArr,
    }),
    compliance_flags: obj({
      confidence: num,
      items: {
        type: "array",
        items: obj({ kind: str, note: str, evidence: intArr }),
      },
    }),
    proposed_disposition: obj({
      confidence: num,
      key: { type: "string", enum: [...CALL_OUTCOME_KEYS] },
      outcome: { type: "string", enum: [...CALL_OUTCOME_KEYS] },
      rationale: str,
      evidence: intArr,
    }),
  });
}

// ── Strict validation (model output → CallAnalysis | null) ───────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Clamp into [0, 1]; non-finite is shape drift (returns null). */
function asConfidence(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/**
 * Evidence indices must reference REAL transcript turns. Non-integers and
 * out-of-range indices are dropped (not fatal — a claim losing a bad citation
 * beats losing the whole analysis), deduped, and sorted.
 */
export function sanitizeEvidence(v: unknown, turnCount?: number): number[] | null {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  const out = new Set<number>();
  for (const e of v) {
    const n = Number(e);
    if (!Number.isInteger(n) || n < 0) continue;
    if (turnCount != null && n >= turnCount) continue;
    out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** "" → undefined — the schema's stand-in for an absent optional field. */
function asOptional(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * Validate a raw model payload into a CallAnalysis. STRICT on shape: any kind
 * missing, any wrong container type, any missing required field, or an outcome
 * outside the canonical set rejects the WHOLE payload to null — never throws,
 * never repairs drift into something half-true. Lenient only where leniency is
 * safe: individual malformed list ITEMS are dropped, evidence is bounds-checked
 * against the turn count, confidence is clamped.
 */
export function parseAnalysis(
  raw: unknown,
  /** How many transcript turns the model was shown — the evidence bound. */
  turnCount?: number,
): CallAnalysis | null {
  if (!isRecord(raw)) return null;

  // summary
  const s = raw.summary;
  if (!isRecord(s)) return null;
  const sConf = asConfidence(s.confidence);
  const sText = asString(s.text);
  if (sConf == null || sText == null || !Array.isArray(s.keyPoints)) return null;
  const summary: SummaryArtifact = {
    confidence: sConf,
    text: sText,
    keyPoints: s.keyPoints.filter((k): k is string => typeof k === "string" && k.trim().length > 0),
  };

  // facts
  const f = raw.facts;
  if (!isRecord(f) || !Array.isArray(f.items)) return null;
  const fConf = asConfidence(f.confidence);
  if (fConf == null) return null;
  const factItems: FactItem[] = [];
  for (const it of f.items) {
    if (!isRecord(it)) continue;
    const label = asString(it.label);
    const value = asString(it.value);
    const evidence = sanitizeEvidence(it.evidence, turnCount);
    if (label == null || value == null || evidence == null) continue;
    if (!label.trim() || !value.trim()) continue;
    factItems.push({ label, value, evidence });
  }
  const facts: FactsArtifact = { confidence: fConf, items: factItems };

  // objections
  const o = raw.objections;
  if (!isRecord(o) || !Array.isArray(o.items)) return null;
  const oConf = asConfidence(o.confidence);
  if (oConf == null) return null;
  const objectionItems: ObjectionItem[] = [];
  for (const it of o.items) {
    if (!isRecord(it)) continue;
    const objection = asString(it.objection);
    const evidence = sanitizeEvidence(it.evidence, turnCount);
    if (objection == null || !objection.trim() || evidence == null) continue;
    objectionItems.push({
      objection,
      ...(asOptional(it.response) ? { response: asOptional(it.response) } : {}),
      evidence,
    });
  }
  const objections: ObjectionsArtifact = { confidence: oConf, items: objectionItems };

  // commitments
  const c = raw.commitments;
  if (!isRecord(c) || !Array.isArray(c.items)) return null;
  const cConf = asConfidence(c.confidence);
  if (cConf == null) return null;
  const commitmentItems: CommitmentItem[] = [];
  for (const it of c.items) {
    if (!isRecord(it)) continue;
    const who = asString(it.who);
    const what = asString(it.what);
    const evidence = sanitizeEvidence(it.evidence, turnCount);
    if (who == null || what == null || evidence == null) continue;
    if (!who.trim() || !what.trim()) continue;
    commitmentItems.push({
      who,
      what,
      ...(asOptional(it.when) ? { when: asOptional(it.when) } : {}),
      evidence,
    });
  }
  const commitments: CommitmentsArtifact = { confidence: cConf, items: commitmentItems };

  // appointment_signals
  const a = raw.appointment_signals;
  if (!isRecord(a)) return null;
  const aConf = asConfidence(a.confidence);
  const aEvidence = sanitizeEvidence(a.evidence, turnCount);
  if (aConf == null || typeof a.present !== "boolean" || aEvidence == null) return null;
  const appointment_signals: AppointmentSignalsArtifact = {
    confidence: aConf,
    present: a.present,
    ...(asOptional(a.when) ? { when: asOptional(a.when) } : {}),
    evidence: aEvidence,
  };

  // compliance_flags
  const cf = raw.compliance_flags;
  if (!isRecord(cf) || !Array.isArray(cf.items)) return null;
  const cfConf = asConfidence(cf.confidence);
  if (cfConf == null) return null;
  const flagItems: ComplianceFlagItem[] = [];
  for (const it of cf.items) {
    if (!isRecord(it)) continue;
    const kind = asString(it.kind);
    const note = asString(it.note);
    const evidence = sanitizeEvidence(it.evidence, turnCount);
    if (kind == null || note == null || evidence == null) continue;
    if (!kind.trim()) continue;
    flagItems.push({ kind, note, evidence });
  }
  const compliance_flags: ComplianceFlagsArtifact = { confidence: cfConf, items: flagItems };

  // proposed_disposition — the one artifact that can ACT on the record, so it
  // is validated hardest: key and outcome must both be canonical stored keys.
  const pd = raw.proposed_disposition;
  if (!isRecord(pd)) return null;
  const pdConf = asConfidence(pd.confidence);
  const key = asString(pd.key);
  const outcome = asString(pd.outcome);
  const rationale = asString(pd.rationale);
  const pdEvidence = sanitizeEvidence(pd.evidence, turnCount);
  if (pdConf == null || key == null || outcome == null || rationale == null) return null;
  if (pdEvidence == null) return null;
  if (!CALL_OUTCOME_KEYS.includes(key as CallOutcome)) return null;
  if (!CALL_OUTCOME_KEYS.includes(outcome as CallOutcome)) return null;
  const proposed_disposition: ProposedDispositionArtifact = {
    confidence: pdConf,
    key,
    outcome: outcome as CallOutcome,
    rationale,
    evidence: pdEvidence,
  };

  return {
    summary,
    facts,
    objections,
    commitments,
    appointment_signals,
    compliance_flags,
    proposed_disposition,
  };
}

/**
 * The turn indices an artifact cites, flattened for the row-level
 * `call_artifacts.evidence` column (item-level evidence stays in the payload).
 */
export function artifactEvidence(kind: ArtifactKind, analysis: CallAnalysis): number[] {
  const union = (lists: number[][]): number[] =>
    [...new Set(lists.flat())].sort((a, b) => a - b);
  switch (kind) {
    case "summary":
      return [];
    case "facts":
      return union(analysis.facts.items.map((i) => i.evidence));
    case "objections":
      return union(analysis.objections.items.map((i) => i.evidence));
    case "commitments":
      return union(analysis.commitments.items.map((i) => i.evidence));
    case "appointment_signals":
      return [...analysis.appointment_signals.evidence];
    case "compliance_flags":
      return union(analysis.compliance_flags.items.map((i) => i.evidence));
    case "proposed_disposition":
      return [...analysis.proposed_disposition.evidence];
  }
}

/** An artifact kind's payload + confidence, uniformly. */
export function artifactPayload(
  kind: ArtifactKind,
  analysis: CallAnalysis,
): { payload: Record<string, unknown>; confidence: number } {
  const artifact = analysis[kind] as unknown as Record<string, unknown> & {
    confidence: number;
  };
  return { payload: artifact, confidence: artifact.confidence };
}
