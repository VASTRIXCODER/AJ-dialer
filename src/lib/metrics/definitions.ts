import type { CallOutcome } from "../types";

/**
 * The outcomes that mean a real conversation happened.
 *
 * This lives here, in the canonical metric module, rather than in the reporting
 * helper that used to own it — `call-analytics.ts` now re-exports it. The
 * direction matters: `isConnectedRow` there delegates to `isConnectedRecord`
 * here, and the old arrangement would have made that a circular import.
 */
export const CONNECTED_OUTCOMES = new Set<CallOutcome>([
  "appointment_booked",
  "callback_scheduled",
  "qualified",
  "not_interested",
  "do_not_call",
]);

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
/**
 * Is this appointment cancelled?
 *
 * Both spellings, because `appointments.status` is a bare `text` column with no
 * CHECK constraint (supabase/schema.sql) — nothing has ever prevented a
 * `canceled` row from arriving via an import or a direct edit, and
 * src/lib/metrics/compute.ts has excluded both spellings all along while
 * src/lib/db/metrics.ts — the code that actually feeds the two shipped tiles
 * carrying `definitionKey="appointments_set"` — excluded only the British one.
 *
 * Whether any US-spelled row exists in this database today is unverified; there
 * is no DB access from here. What is verifiable is that two modules disagreed
 * about the same exclusion, and now they cannot.
 */
export function isCancelledAppointment(status: string | null | undefined): boolean {
  return status === "cancelled" || status === "canceled";
}

export function isConnectedRecord(r: {
  humanConnected?: boolean | null;
  outcome?: string | null;
}): boolean {
  if (r.outcome === "voicemail") return false;
  if (typeof r.humanConnected === "boolean") return r.humanConnected;
  return r.outcome != null && CONNECTED_OUTCOMES.has(r.outcome as CallOutcome);
}

/**
 * The SAME predicate, as a PostgREST filter — for the counts that must be done
 * in the database rather than over fetched rows.
 *
 * This exists because two screens had hand-rolled their own version of it and
 * both were wrong in the same two ways. `/today` and `/command` each counted
 * today's conversations with
 *
 *     .or("human_connected.is.true,outcome.in.(…connected outcomes…)")
 *
 * which differs from `isConnectedRecord` in exactly the cases the predicate was
 * written to handle:
 *
 *   · a VOICEMAIL row carrying `human_connected = true` — the flag that AMD
 *     race conditions are documented above as setting on machine pickups —
 *     matched the first arm and counted as a conversation. The whole point of
 *     the voicemail short-circuit is that it must not.
 *   · a row where the answer pipeline positively recorded `human_connected =
 *     false` still counted if its outcome happened to be a connected one. The
 *     verified flag is supposed to WIN over the legacy outcome inference; the
 *     `.or()` let the outcome overrule it.
 *
 * Both errors push the same way — up — so a rep's "Conversations" tile read
 * higher than the same rep's connect rate on the dashboard, every single day.
 *
 * The three arms below are the JS branches, in order:
 *   1. verified true, and not a voicemail
 *   2. verified true with no outcome recorded yet (a live/unfiled row)
 *   3. not verified either way — fall back to the outcome, which cannot be
 *      voicemail because voicemail is not in CONNECTED_OUTCOMES
 *
 * `human_connected = false` matches none of them, which is the point.
 * tests/metric-registry.test.ts evaluates this expression against
 * `isConnectedRecord` over every combination and fails if they ever disagree.
 */
export function connectedRecordFilter(): string {
  const list = [...CONNECTED_OUTCOMES].join(",");
  return [
    "and(human_connected.is.true,outcome.neq.voicemail)",
    "and(human_connected.is.true,outcome.is.null)",
    `and(human_connected.is.null,outcome.in.(${list}))`,
  ].join(",");
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
