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
  | "calls_dialed"
  | "human_connects"
  | "connect_rate"
  | "appointments_set"
  | "appointment_outcomes"
  | "appointment_show_rate"
  | "avg_talk_time"
  | "talk_time_total"
  | "leads_worked"
  | "speed_to_first_call"
  | "callbacks_overdue"
  | "callbacks_due_now"
  | "estimated_call_spend"
  | "cost_per_appointment"
  | "weekly_performance"
  | "outcome_mix"
  | "hourly_productivity"
  | "campaign_pipeline";

// ─────────────────────────────────────────────────────────────────────────────
// A number without a window and a scope is not a number, it is a rumour.
//
// The audit that produced this section found "Appointments" meaning five
// different things across the product and "Upcoming" meaning two, with nothing
// on any of the tiles to tell them apart. It also found the same window written
// three different ways ("today", "dials placed today", "Today so far · you").
//
// So the window and the scope are ENUMS, and the words come from here. A screen
// picks which window it is showing; it does not get to phrase it. Two tiles
// showing the same window are now incapable of describing it differently.
// ─────────────────────────────────────────────────────────────────────────────

export type MetricWindow =
  /** The org's current local day, from its own midnight. */
  | "today"
  | "last_7d"
  | "last_30d"
  | "last_90d"
  /** The range bar's current selection — pair with `windowDetail`. */
  | "period"
  /** Everything ever recorded. Named, because it is the least likely default a
   *  reader assumes and several tiles quietly use it. */
  | "all_time"
  /** Not a window at all: the state of the book right now. */
  | "current";

export type MetricScope =
  /** This rep's own rows, always — never widened for a supervisor. */
  | "me"
  /** The whole workspace. */
  | "org"
  /** Org for a supervisor, the viewer's own rows otherwise. The honest label
   *  for the many surfaces that switch on the viewer's role. */
  | "org_or_me"
  | "campaign"
  /** Across every workspace on the platform (the superadmin console). */
  | "platform";

const WINDOW_LABEL: Record<MetricWindow, string> = {
  today: "today",
  last_7d: "last 7 days",
  last_30d: "last 30 days",
  last_90d: "last 90 days",
  period: "selected period",
  all_time: "all time",
  current: "right now",
};

const SCOPE_LABEL: Record<MetricScope, string> = {
  me: "you",
  org: "whole org",
  org_or_me: "your scope",
  campaign: "this campaign",
  platform: "whole platform",
};

export function describeWindow(w: MetricWindow, detail?: string): string {
  return detail ? `${WINDOW_LABEL[w]} (${detail})` : WINDOW_LABEL[w];
}

export function describeScope(s: MetricScope): string {
  return SCOPE_LABEL[s];
}

/**
 * The caption under a KPI number: what it covers, and whose it is.
 *
 * `detail` is for the one window that cannot be named in advance — a range
 * bar's current selection — so it reads "selected period (1–30 Aug) · whole
 * org" rather than making the reader guess.
 */
export function metricCaption(
  window: MetricWindow,
  scope: MetricScope,
  detail?: string,
): string {
  return `${describeWindow(window, detail)} · ${describeScope(scope)}`;
}

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
      "Attempts whose disposition means a conversation happened — appointment, callback, qualified, not interested, or do-not-call. Voicemail never counts, even when the carrier reported an answer. NOTE: call_records.human_connected exists but nothing writes it (0 of 34,079 rows as of 2026-08-30), so this is inferred from the outcome the rep filed, not from a verified answer signal.",
    unit: "count",
    denominator: null,
    excludes: ["Voicemail (always separate)", "Busy", "Declined", "No-answer", "Failures"],
  },
  connect_rate: {
    id: "connect_rate",
    label: "Connect rate",
    description:
      "Human connects ÷ eligible completed attempts. Same everywhere — dashboard, reports, leaderboard and monitor use this one definition.",
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
      "Total talk seconds on connected calls ÷ connected calls. Measured from duration_sec, which a manual call starts counting at pickup rather than at dial — so ring time is already out. NOTE: call_records.talk_sec exists but nothing writes it (0 of 34,079 rows as of 2026-08-30); an AI conversation's duration comes from the provider and may include more than talk.",
    unit: "seconds",
    denominator: "Human-connected calls only.",
    excludes: ["Ringing", "Queue time", "Voicemail time", "Wrap-up"],
  },
  weekly_performance: {
    id: "weekly_performance",
    label: "Performance this week",
    description:
      "Daily attempt/connect/appointment series for the last seven org-local days, ending today — a rolling window, NOT the calendar week that starts on the workspace's configured week start. The leaderboard uses that calendar week; this trend deliberately does not, so the newest day is always the last bar.",
    unit: "count",
    denominator: null,
    excludes: [],
  },
  outcome_mix: {
    id: "outcome_mix",
    label: "Outcome mix",
    description:
      "Counts per canonical terminal outcome; mutually exclusive; the percentages divide by attempts that HAVE an outcome, so the buckets sum to 100%. Attempts with no outcome filed yet are reported separately rather than folded into a bucket — they used to sit in the denominator and in none of the buckets, which understated every disposition.",
    unit: "count",
    denominator: null,
    excludes: [],
  },
  hourly_productivity: {
    id: "hourly_productivity",
    label: "Hourly productivity",
    description:
      "Attempts and connects grouped by local call-start hour, covering 8am–6pm as a floor and widening to include any hour that actually has calls — evening and early-morning work is no longer dropped off the ends. DST-safe by construction: buckets are local-hour labels, so a 23- or 25-hour day has fewer or more populated buckets and never double-counts.",
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

  // ── Added by W5 ────────────────────────────────────────────────────────────
  // An id earns its place here only if the number appears on two or more
  // screens, or is actively contested between them. A glossary entry read once
  // is worse than none, because it implies the number was reconciled when it
  // wasn't.

  calls_dialed: {
    id: "calls_dialed",
    label: "Calls dialed",
    description:
      "Outbound call attempts accepted for dialing across the selected period — the period-scoped twin of Calls today. The range is always displayed, because the default on Reports is all time and that is the last thing a reader assumes.",
    unit: "count",
    denominator: null,
    excludes: [
      "Test records",
      "Pre-provider suppressions (DNC/invalid blocked before dial)",
      "Canceled reservations that never became an attempt",
    ],
  },
  appointment_outcomes: {
    id: "appointment_outcomes",
    label: "Booked on calls",
    description:
      "Call attempts dispositioned as an appointment. This is an EVENT count, not a booking count: two calls to one lead both dispositioned that way count twice, and a booking later superseded still counts, because the appointment row is cancelled rather than deleted. For what is actually on the books, see Appointments set.",
    unit: "count",
    denominator: null,
    excludes: [
      "Appointments created without a call",
      "Nothing for cancellation — a cancelled booking's call row still counts",
    ],
  },
  appointment_show_rate: {
    id: "appointment_show_rate",
    label: "Show rate",
    description:
      "Completed appointments ÷ appointments that resolved either way. Cancelled, rescheduled and still-scheduled rows are in neither half, so this answers 'of the ones that came due, how many were held?' rather than 'how many of everything booked'.",
    unit: "percent",
    denominator:
      "Appointments with status completed or no_show. Cancelled, rescheduled and still-scheduled rows are excluded from both halves.",
    excludes: [
      "Cancelled appointments",
      "Rescheduled appointments",
      "Appointments still in the future",
    ],
  },
  talk_time_total: {
    id: "talk_time_total",
    label: "Talk time",
    description:
      "Summed talk seconds for the period — a TOTAL, not the per-call mean that Avg talk time reports under a similar name. NOTE: call_records.talk_sec exists but nothing writes it (0 of 34,079 rows as of 2026-08-30), so this sums duration_sec, which a manual call starts counting at pickup.",
    unit: "seconds",
    denominator: null,
    excludes: ["Ringing", "Queue time", "Voicemail time", "Wrap-up"],
  },
  leads_worked: {
    id: "leads_worked",
    label: "Leads worked",
    description:
      "Distinct leads touched by at least one call attempt in the period. A lead dialed six times counts once — this is reach, where Calls today is effort.",
    unit: "count",
    denominator: null,
    excludes: [
      "Repeat attempts on a lead already counted",
      "Call rows with no lead attached",
    ],
  },
  speed_to_first_call: {
    id: "speed_to_first_call",
    label: "Speed to first call",
    description:
      "Median minutes from an opportunity arriving to its first dial attempt, over opportunities FIRST attempted in the period — one received last week and first dialed today counts, carrying its multi-day gap. A median rather than a mean, because a single forgotten record would otherwise move the number more than the day's work did.",
    unit: "seconds",
    denominator: null,
    excludes: [
      "Opportunities never attempted",
      "Rows whose first attempt precedes their arrival (clock skew)",
    ],
  },
  callbacks_overdue: {
    id: "callbacks_overdue",
    label: "Overdue callbacks",
    description:
      "Open callbacks whose agreed time has passed, compared against the ORG's own wall clock — never the server's and never the browser's. A callback with no agreed time is never overdue; it is counted as due now instead.",
    unit: "count",
    denominator: null,
    excludes: [
      "Completed and cancelled callbacks",
      "Callbacks with no agreed time (counted as due now)",
    ],
  },
  callbacks_due_now: {
    id: "callbacks_due_now",
    label: "Callbacks due now",
    description:
      "Open callbacks within a minute either side of their agreed time, PLUS every open callback with no agreed time at all — an unscheduled promise is due now by default, never filed under 'later'.",
    unit: "count",
    denominator: null,
    excludes: ["Completed and cancelled callbacks"],
  },
  estimated_call_spend: {
    id: "estimated_call_spend",
    label: "Est. call spend",
    description:
      "Talk minutes × the workspace's configured per-minute rate, summed across the AI and human channels. An estimate from call time only.",
    unit: "count",
    denominator: null,
    excludes: [
      "Carrier fees and number rental — this is call time only",
      "Anything the workspace has not configured a rate for",
    ],
  },
  cost_per_appointment: {
    id: "cost_per_appointment",
    label: "Cost per appointment",
    description:
      "Estimated call spend ÷ appointments booked on calls in the same period. The denominator is the call-event count, not the appointments table — so this reconciles with 'Booked on calls' beside it, and NOT with 'Appointments set'.",
    unit: "count",
    denominator:
      "Appointment-booked call outcomes in the period. A period with none reports as unavailable rather than as zero or infinity.",
    excludes: ["Periods with no bookings, which are unavailable rather than divided"],
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
