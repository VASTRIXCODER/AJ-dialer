import type { CallOutcome } from "../types";
import { CONNECTED_OUTCOMES } from "../call-analytics";

// ─────────────────────────────────────────────────────────────────────────────
// The metric glossary as code — the twin of docs/phase-1/metric-glossary.md.
// Every surface that shows one of these numbers renders the SAME description as
// its tooltip and computes through the same predicates below, so "connect rate"
// can never quietly mean three different things on three different screens.
// Pure module: no DB, no env, importable from Server and Client Components.
// ─────────────────────────────────────────────────────────────────────────────

export type MetricId =
  | "calls_today"
  | "human_connects"
  | "connect_rate"
  | "appointments_set"
  | "avg_talk_time"
  | "weekly_performance"
  | "outcome_mix"
  | "hourly_productivity"
  | "campaign_pipeline";

export interface MetricDef {
  id: MetricId;
  label: string;
  /** Tooltip text — kept verbatim in sync with the glossary doc. */
  description: string;
  unit: "count" | "percent" | "seconds";
  /** What the metric divides by, when it divides at all. */
  denominator: string | null;
  /** What is deliberately NOT in the number, spelled out for the tooltip. */
  excludes: string[];
}

export const METRICS: Record<MetricId, MetricDef> = {
  calls_today: {
    id: "calls_today",
    label: "Calls today",
    description:
      "Count of outbound call attempts accepted for dialing during the org's current local day.",
    unit: "count",
    denominator: null,
    excludes: [
      "Test records",
      "Pre-provider suppressions (DNC/invalid blocked before dial)",
      "Canceled reservations that never became an attempt",
    ],
  },
  human_connects: {
    id: "human_connects",
    label: "Human connects",
    description:
      "Attempts that reached a verified human-connected state (coalesce(human_connected, outcome ∈ CONNECTED_OUTCOMES) during the legacy transition).",
    unit: "count",
    denominator: null,
    excludes: ["Voicemail (always separate)", "Busy", "Declined", "No-answer", "Failures"],
  },
  connect_rate: {
    id: "connect_rate",
    label: "Connect rate",
    description:
      "Human connects ÷ eligible completed attempts. Same everywhere — dashboard, reports, leaderboard, and monitor use this one definition.",
    unit: "percent",
    denominator:
      "Completed outbound attempts in the period, excluding system failures (failure_kind set with no outcome) and pre-dial suppressions.",
    excludes: ["System failures (failure_kind set with no outcome)", "Pre-dial suppressions"],
  },
  appointments_set: {
    id: "appointments_set",
    label: "Appointments set",
    description:
      "Distinct non-cancelled appointments created in the period. Edits/reschedules of an existing appointment never increment it.",
    unit: "count",
    denominator: null,
    excludes: ["Cancelled rows", "Edits/reschedules of an existing appointment"],
  },
  avg_talk_time: {
    id: "avg_talk_time",
    label: "Avg talk time",
    description:
      "Total human-connected talk seconds ÷ human-connected calls. Uses talk_sec (connected→ended) when present; falls back to duration_sec for legacy rows.",
    unit: "seconds",
    denominator: "Human-connected calls only.",
    excludes: ["Ringing", "Queue time", "Voicemail time", "Wrap-up"],
  },
  weekly_performance: {
    id: "weekly_performance",
    label: "Performance this week",
    description:
      "Daily attempt/connect/appointment series for the org-tz calendar week starting on the configured week start. The exact date range is displayed.",
    unit: "count",
    denominator: null,
    excludes: [],
  },
  outcome_mix: {
    id: "outcome_mix",
    label: "Outcome mix",
    description:
      "Counts per canonical terminal outcome; mutually exclusive; reconciles to attempts-with-outcome for the same filters. Rows without an outcome are shown as their own bucket, never silently dropped.",
    unit: "count",
    denominator: null,
    excludes: [],
  },
  hourly_productivity: {
    id: "hourly_productivity",
    label: "Hourly productivity",
    description:
      "Attempts, human connects, appointments, and talk time grouped by local call-start hour. DST-safe by construction: buckets are local-hour labels; a 23/25-hour day has fewer/more populated buckets, never double-counts.",
    unit: "count",
    denominator: null,
    excludes: [],
  },
  campaign_pipeline: {
    id: "campaign_pipeline",
    label: "Campaign pipeline",
    description:
      "Mutually exclusive current-state buckets per lead (eligible / assigned / attempted / connected / callback / appointment / converted / DNC / exhausted). A lead appears in exactly one bucket; event totals are shown separately from unique-lead counts.",
    unit: "count",
    denominator: null,
    excludes: [],
  },
};

/**
 * The one "did a human really answer?" predicate. `human_connected` is the
 * verified flag written by the answer pipeline; legacy rows predate it, so when
 * it's absent we coalesce to the outcome-based definition (CONNECTED_OUTCOMES).
 * Voicemail is NEVER a connect — it wins even over a stray humanConnected=true,
 * because AMD race conditions have set the flag on machine pickups and a
 * voicemail must never inflate the connect rate.
 */
export function isConnectedRecord(r: {
  humanConnected?: boolean | null;
  outcome?: string | null;
}): boolean {
  if (r.outcome === "voicemail") return false;
  if (typeof r.humanConnected === "boolean") return r.humanConnected;
  return r.outcome != null && CONNECTED_OUTCOMES.has(r.outcome as CallOutcome);
}

/**
 * The one timezone fallback. Before Phase 1, "today" was computed against UTC on
 * some surfaces and America/Chicago on others, so the dashboard and reports could
 * disagree near midnight. Every window now resolves through this: the org's own
 * timezone when set, America/Chicago otherwise.
 */
export function orgTimezone(org: { timezone?: string | null } | null | undefined): string {
  return org?.timezone || "America/Chicago";
}
