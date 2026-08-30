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
  | "campaign_pipeline"
  // King's Command Center (§17) — see the block comment in METRICS below.
  | "leads_worked"
  | "contacts_made"
  | "appointments_confirmed"
  | "appointments_at_risk"
  | "no_shows"
  | "no_show_recovered"
  | "sales_closed"
  | "installs_completed"
  | "hot_opportunities"
  | "speed_to_lead"
  | "followup_completion";

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

  // ── King's Command Center · docs/phase_two.md §17 ───────────────────────────
  //
  // §17: "Extend the Phase 1 shared metrics service. Do not recalculate these
  // independently in each widget." So the ten cards King's strip asks for are
  // defined here, once, and the tile, its tooltip and its drill-down cannot
  // disagree about what the number means.
  //
  // FIVE OF THEM CANNOT BE COMPUTED with the data this deployment has. Their
  // definitions say so in the first three words, and the tiles render
  // unavailable with the reason rather than a confident zero. §17 also says
  // "do not hard-code example numbers" — a fabricated 0 on a leadership
  // dashboard is worse than a hard-coded one, because it looks earned.

  leads_worked: {
    id: "leads_worked",
    label: "Worked",
    description:
      "Unique opportunities with at least one qualifying outbound touch initiated today, in the org's timezone. A contact dialed six times counts ONCE — this is reach, where Dials beside it is effort. It rides a bounded scan, so on a very heavy day it reports as a floor (≥) rather than silently truncating.",
    unit: "count",
    denominator: null,
    excludes: [
      "Repeat touches on a lead already counted today",
      "Attempts refused before dialing (DNC, invalid number, outside the calling window)",
    ],
  },
  contacts_made: {
    id: "contacts_made",
    label: "Contacts",
    description:
      "Unique opportunities where a human actually answered today, through the same connect predicate every other surface uses — so voicemail never counts here however the outcome was filed.",
    unit: "count",
    denominator: null,
    excludes: ["Voicemail", "Ring-no-answer", "Provider failures"],
  },
  appointments_confirmed: {
    id: "appointments_confirmed",
    label: "Confirmed",
    description:
      "NOT COMPUTABLE HERE. §17 defines this as appointments that entered a Confirmed state in the period. Confirming means reaching the customer, and this deployment has no channel that can: outbound SMS has never run, and customer email does not exist. Nothing writes a confirmed state, so any number would be invented.",
    unit: "count",
    denominator: null,
    excludes: ["Everything — the state this counts is never written"],
  },
  appointments_at_risk: {
    id: "appointments_at_risk",
    label: "At risk",
    description:
      "NOT COMPUTABLE HERE. §17 defines this as upcoming appointments matching a PUBLISHED risk rule. No risk rule has been defined or published for this workspace, and a risk score invented at the tile would be a guess wearing a number's clothes.",
    unit: "count",
    denominator: null,
    excludes: ["Everything — no risk rule exists to match against"],
  },
  no_shows: {
    id: "no_shows",
    label: "No-shows",
    description:
      "Appointments whose status is no_show, counted against the day they were scheduled for. A rep sets this by hand at wrap-up — there is no automatic grace-period declaration — so it is exactly as complete as the floor's own filing, and no more.",
    unit: "count",
    denominator: null,
    excludes: ["Cancelled appointments, which are a different outcome"],
  },
  no_show_recovered: {
    id: "no_show_recovered",
    label: "Recovered",
    description:
      "NOT COMPUTABLE HERE. §17 defines this as recovery instances that produced a NEW valid appointment. Nothing links a rebooked appointment back to the no-show it replaces, so the two cannot be paired — and counting every appointment booked after a no-show would flatter the number badly.",
    unit: "count",
    denominator: null,
    excludes: ["Everything — no link exists between a no-show and its rebooking"],
  },
  sales_closed: {
    id: "sales_closed",
    label: "Sales",
    description:
      "NOT COMPUTABLE HERE. §17 requires opportunities entering a TRUSTED Sold state. The stage machine hard-gates `sold` to manager and system_fulfillment actors precisely because no trusted external source has been named yet. Until one is, this workspace has no fact to count.",
    unit: "count",
    denominator: null,
    excludes: ["Everything — no trusted fulfillment source is wired"],
  },
  installs_completed: {
    id: "installs_completed",
    label: "Installs",
    description:
      "NOT COMPUTABLE HERE. Depends on the same trusted fulfillment source as Sales. Nothing in this deployment observes an install.",
    unit: "count",
    denominator: null,
    excludes: ["Everything — no trusted fulfillment source is wired"],
  },
  hot_opportunities: {
    id: "hot_opportunities",
    label: "Hot",
    description:
      "Open, unexpired signals raised by the detector and neither acknowledged nor dismissed. Signals dedupe per lead and per type, so one contact showing three buying cues raises three signals, not thirty.",
    unit: "count",
    denominator: null,
    excludes: ["Acknowledged signals", "Dismissed signals", "Expired signals"],
  },
  speed_to_lead: {
    id: "speed_to_lead",
    label: "Speed to lead",
    description:
      "Median minutes from a lead becoming eligible to its first outbound attempt, today, org-wide. A MEDIAN, not a mean: one lead worked three days late drags an average past usefulness. Reported only above a minimum sample — below it the tile says so rather than quoting a figure computed from two rows.",
    unit: "seconds",
    denominator: "Leads that became eligible today AND have been attempted at least once.",
    excludes: [
      "Leads not yet attempted — they have no interval, and are counted in Untouched instead",
      "Days below the minimum sample",
    ],
  },
  followup_completion: {
    id: "followup_completion",
    label: "Follow-up completion",
    description:
      "NOT COMPUTABLE HERE. §17 defines this as due follow-up work completed inside its allowed window, over follow-up work due in the period. Work items carry no allowed-window field, so \"on time\" has nothing to test against — and the orchestration engine that would generate the work has never executed in production.",
    unit: "percent",
    denominator: "Would be: follow-up work items due in the period.",
    excludes: ["Everything — work items have no completion window to measure against"],
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
