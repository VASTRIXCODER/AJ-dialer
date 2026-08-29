import type { LeadStatus } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Reactivation cohorts (P2.9): aged books re-entered DELIBERATELY. Each cohort
// is a rule, not a query the operator invents — so "who gets re-dialed and
// why" is explainable, and the exclusions are non-negotiable:
//
//   · DNC never enters a cohort (status-blocked AND number-scrubbed downstream)
//   · an open callback excludes a lead — a promise beats a sweep
//   · a lead someone is actively holding is skipped
//   · over-attempted numbers are skipped (repeat-dialing burns caller IDs)
//
// Calls only. SMS/email re-engagement stays provider-blocked (see
// docs/phase-2/channel-and-provider-capabilities.md) and is NOT simulated.
// ─────────────────────────────────────────────────────────────────────────────

export type ReactivationCohortKey = "gone_quiet" | "nurture_ripe" | "aged_untouched";

export interface ReactivationCohort {
  key: ReactivationCohortKey;
  /** Neutral label — surfaces may re-word with org vocabulary on top. */
  label: string;
  /** The "why now" for the whole cohort, in plain words. */
  hint: string;
  statuses: LeadStatus[];
  /** How long since the last activity before a lead qualifies. */
  agedDays: number;
  /** Which clock "aged" is judged against. */
  agedField: "last_attempt" | "created";
  /** Skip leads at or above this many attempts (0 = require never-attempted). */
  maxAttempts: number;
}

export const REACTIVATION_COHORTS: ReactivationCohort[] = [
  {
    key: "gone_quiet",
    label: "Gone quiet",
    hint: "Rang or spoke 30+ days ago, then nothing. One fresh attempt is due.",
    statuses: ["no_answer", "contacted"],
    agedDays: 30,
    agedField: "last_attempt",
    maxAttempts: 8,
  },
  {
    key: "nurture_ripe",
    label: "Worth another look",
    // The builder re-words "no need" with the org's own label client-side.
    hint: "Said no need 60+ days ago. Situations change — one respectful check-in.",
    statuses: ["bills_fine"],
    agedDays: 60,
    agedField: "last_attempt",
    maxAttempts: 10,
  },
  {
    key: "aged_untouched",
    label: "Fell through the cracks",
    hint: "Uploaded 45+ days ago and never called once.",
    statuses: ["new"],
    agedDays: 45,
    agedField: "created",
    maxAttempts: 0,
  },
];

export function reactivationCohort(key: string): ReactivationCohort | null {
  return REACTIVATION_COHORTS.find((c) => c.key === key) ?? null;
}

/** The aged-before cutoff for a cohort, as an ISO instant. Pure. */
export function reactivationCutoffIso(cohort: ReactivationCohort, now: Date): string {
  return new Date(now.getTime() - cohort.agedDays * 86_400_000).toISOString();
}

/** Session-meta summary line for a loaded cohort. Pure. */
export function reactivationSummary(
  cohort: ReactivationCohort,
  loaded: number,
  leadNounPlural: string,
): string {
  return `Reactivation · ${cohort.label} · ${loaded} ${leadNounPlural} · quiet ${cohort.agedDays}+ days`;
}
