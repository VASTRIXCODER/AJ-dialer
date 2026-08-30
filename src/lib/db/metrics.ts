import "server-only";

import {
  activeCalls as sampleActive,
  appointments as sampleAppts,
  hourlyCalls as sampleHourly,
  kpiSeries as sampleKpi,
  leaderboard as sampleLeaderboard,
  metrics as sampleMetrics,
  outcomeBreakdown as sampleOutcomes,
  callRecords as sampleRecords,
} from "../data";
import { reconcileAndGetMonitor } from "../ai-call-reconcile";
import {
  channelBreakdown,
  dispositionBreakdown,
  funnelOf,
  type ChannelRow,
  type DispositionRow,
  type Funnel,
} from "../call-analytics";
import { zonedDayHour, zonedDayKey } from "../dialer/schedule";
import {
  isCancelledAppointment,
  isConnectedRecord,
  orgTimezone,
} from "../metrics/definitions";
import {
  composeLeaderboard,
  type ComposedBoard,
  type LeaderboardMember,
  type LeaderboardPeriodMeta,
  type LeaderboardPeriodStat,
} from "../leaderboard";
import {
  DEFAULT_LEADERBOARD,
  mergeLeaderboardSettings,
  type LeaderboardSettings,
} from "../org/settings";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type {
  AILiveState,
  CallOutcome,
  KpiPoint,
  MetricSummary,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// DB-computed reporting. Every dashboard / report / leaderboard number is
// derived here from the account's own Supabase rows (call_records, appointments,
// leads, ai_conversations). When Supabase isn't configured or there's no
// session, it falls back to the bundled data module so demo mode still works.
// ─────────────────────────────────────────────────────────────────────────────

/** The one lifecycle (src/lib/types.ts) — this was a fourth private copy of it. */
export type LiveCallState = AILiveState;

export interface RecentCall {
  id: string;
  leadName: string;
  channel: "ai" | "human";
  repName?: string;
  phone?: string;
  outcome: CallOutcome | null;
  durationSec: number;
  startedAt: string;
  recordingUrl?: string | null;
  conversationId?: string | null;
  /** The AI/auto-generated executive summary, when one exists. */
  summary?: string | null;
  hasSummary: boolean;
  hasRecording: boolean;
}

/**
 * Turn a stored Twilio recording URL into our authenticated proxy path so the
 * browser can play it (raw Twilio media is private and 401s). Leaves anything
 * that isn't a Twilio recording URL (e.g. already-proxied paths) untouched.
 */
function toPlayableRecording(raw: string | null): string | null {
  if (!raw) return null;
  const m = /\/Recordings\/(RE[0-9a-f]{32})/i.exec(raw);
  return m ? `/api/twilio/recording/${m[1]}` : raw;
}

/**
 * The one "did a human answer?" test for raw call_records rows, routed through
 * the canonical predicate (src/lib/metrics/definitions.ts): the verified
 * `human_connected` flag when stamped, the legacy outcome-based inference
 * otherwise. Every connect figure this file produces goes through here, so it
 * can never drift from the dashboard tiles / RPCs (glossary: human_connects).
 */
const isConnected = (r: Row): boolean =>
  isConnectedRecord({
    humanConnected: r.human_connected as boolean | null | undefined,
    outcome: (r.outcome as string | null | undefined) ?? null,
  });

/** Map one call_records row to the RecentCall shape (recording + transcript aware). */
function mapRecentCall(
  r: Row,
  supervisor: boolean,
  nameById: Map<string, string>,
): RecentCall {
  const outcome = (r.outcome as CallOutcome) ?? null;
  // Only an explicit "ai" channel is an AI call; null/legacy rows are human
  // (matches channelBreakdown so the split is consistent everywhere).
  const channel = r.channel === "ai" ? "ai" : "human";
  const recordingUrl =
    channel === "human"
      ? toPlayableRecording((r.recording_url as string) ?? null)
      : ((r.recording_url as string) ?? null);
  const conversationId = (r.conversation_id as string) ?? null;
  const summary = (r.summary as string) ?? null;
  // A recording only exists when the call actually connected — no-answer /
  // voicemail / failed calls have none, so don't offer a dead "Play" link.
  // "Connected" here is the ONE canonical predicate (glossary: human_connects).
  const hasRecording =
    channel === "human"
      ? Boolean(recordingUrl)
      : Boolean(conversationId && isConnected(r));
  return {
    id: String(r.id ?? conversationId ?? `${r.owner_id}-${r.started_at}`),
    // No name on the row is a DATA gap, not a homeowner. The UI falls back to
    // the phone number (far more useful to a rep) and only then to the
    // workspace's own noun.
    leadName: String(r.lead_name ?? "").trim(),
    channel,
    repName: supervisor ? nameById.get(String(r.owner_id)) || "Rep" : undefined,
    phone: String(r.phone ?? ""),
    outcome,
    durationSec: Number(r.duration_sec ?? 0),
    startedAt: String(r.started_at ?? new Date().toISOString()),
    recordingUrl,
    conversationId,
    summary,
    hasSummary: Boolean(summary),
    hasRecording,
  };
}

export interface CallHistoryPage {
  calls: RecentCall[];
  hasMore: boolean;
  scope: "org" | "own";
}

/**
 * Paginated FULL call history — every call ever logged (not just the recent
 * slice on the reports hero), each with its recording + transcript access.
 * Supervisors get the whole org; reps get their own. Ordered newest-first.
 */
export async function getCallHistory(opts: {
  offset?: number;
  limit?: number;
}): Promise<CallHistoryPage> {
  if (!isSupabaseConfigured()) return { calls: [], hasMore: false, scope: "own" };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { calls: [], hasMore: false, scope: "own" };

    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id,role")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const supervisor = Boolean(
      orgId &&
        ["owner", "admin", "manager"].includes(String(prof?.role ?? "rep")) &&
        isAdminConfigured(),
    );
    const reader = supervisor ? createAdminClient() : supabase;
    const scopeCol = supervisor ? "org_id" : "owner_id";
    const scopeVal = (supervisor ? orgId : user.id) as string;

    const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));

    // Fetch one extra row to know whether there's another page.
    let callHistoryQuery = reader
      .from("call_records")
      .select(
        "id,owner_id,outcome,duration_sec,human_connected,channel,started_at,lead_name,phone,conversation_id,recording_url,summary",
      )
      .eq(scopeCol, scopeVal);
    // A rep's "own" scope must stay within their CURRENT org — never surface
    // calls they happen to own from an org they've since left.
    if (!supervisor && orgId) callHistoryQuery = callHistoryQuery.eq("org_id", orgId);
    const { data, error } = await callHistoryQuery
      .order("started_at", { ascending: false })
      .range(offset, offset + limit);
    if (error) {
      console.error("[metrics] getCallHistory query failed:", error.message);
      return { calls: [], hasMore: false, scope: supervisor ? "org" : "own" };
    }
    const rows = (data ?? []) as Row[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    let nameById = new Map<string, string>();
    if (supervisor && orgId) {
      const { data: mem } = await createAdminClient()
        .from("organization_members")
        .select("user_id,name")
        .eq("org_id", orgId)
        .eq("status", "active");
      nameById = new Map(((mem ?? []) as Row[]).map((m) => [String(m.user_id), String(m.name ?? "")]));
    }

    return {
      calls: page.map((r) => mapRecentCall(r, supervisor, nameById)),
      hasMore,
      scope: supervisor ? "org" : "own",
    };
  } catch (e) {
    console.error("[metrics] getCallHistory failed:", e instanceof Error ? e.message : e);
    return { calls: [], hasMore: false, scope: "own" };
  }
}

export interface LiveCall {
  id: string;
  leadName: string;
  city: string;
  state: LiveCallState;
}

export interface ApptLite {
  id: string;
  leadName: string;
  whenLabel: string;
  source: string;
  status: string;
}

export interface ReportingData {
  metrics: MetricSummary;
  kpiSeries: KpiPoint[];
  /** 30-day daily trend (reports). */
  trend30: KpiPoint[];
  hourlyCalls: { hour: string; calls: number; connects: number }[];
  outcomeBreakdown: { name: string; value: number; color: string }[];
  /** Counts + rates for EVERY disposition. */
  dispositions: DispositionRow[];
  /** AI vs human comparison. */
  channelStats: ChannelRow[];
  /** Dials → connects → appointments. */
  funnel: Funnel;
  recentCalls: RecentCall[];
  liveCalls: LiveCall[];
  appointments: ApptLite[];
  /** Connect rate for TODAY only (org tz) — the dashboard hero shows this beside
   *  "Calls today" so the two figures share a window. Period/all-time connect
   *  rate stays on `metrics.connectRate`. */
  connectRateToday: number;
  /** "org" when the viewer is a supervisor (team-wide) else "own". */
  scope: "org" | "own";
}

type Row = Record<string, unknown>;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const avg = (a: number[]) =>
  a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

const DAY_MS = 86_400_000;
// Row-based views (dispositions, funnel, avg talk, trends) are computed in JS
// from the fetched rows, so the fetch must be COMPLETE for the window in play —
// a fixed `.limit()` silently truncated it (a rep power-dialing hits the old
// 2,000 cap in ~2 weeks, so every 30-day / all-time report undercounted "the
// amount of calls"). We page instead. Ranged views only pull their window; the
// all-time default pages up to this ceiling (the same order-desc-then-cap the
// leaderboard already uses, so a truncation drops the OLDEST rows, never a
// random subset). PAGE is Supabase's max rows per request.
const PAGE = 1000;
const MAX_ROWS = 50_000;

/**
 * Page a scoped query to completion (or a hard ceiling), so no figure is ever
 * silently capped mid-window. `makeQuery` must apply `.range(from, to)` last and
 * order deterministically (newest-first) so a ceiling hit drops oldest rows.
 */
async function fetchPaged(
  makeQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
  cap: number = MAX_ROWS,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) {
      console.error(`[metrics] ${label} page @${from} failed:`, error.message);
      break;
    }
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break; // short page ⇒ end of data
  }
  if (out.length >= cap)
    console.warn(
      `[metrics] ${label} hit the ${cap}-row ceiling — the oldest rows are omitted from this window.`,
    );
  return out;
}

function fmtHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/**
 * Human label for an appointment's time. `scheduled_at` is a FLOATING wall-clock
 * time stored as if it were UTC (see the invariant in src/lib/appointments/time.ts)
 * — so formatting the parsed instant with timeZone "UTC" recovers the intended
 * wall clock exactly. The old no-timeZone call rendered it in SERVER-local time,
 * shifting every appointment by the deploy region's offset. `created_at` IS a
 * real instant, so its fallback date renders in the org's timezone (`tz`).
 */
function apptWhen(a: Row, tz: string): string {
  const label = a.scheduled_label ? String(a.scheduled_label) : "";
  if (label) return label;
  if (a.scheduled_at) {
    return new Date(String(a.scheduled_at)).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC", // floating wall clock — see the banner above
    });
  }
  return a.created_at
    ? new Date(String(a.created_at)).toLocaleDateString("en-US", { timeZone: tz })
    : "Scheduled";
}

export async function getReportingData(
  /** Optional day count to scope KPIs/dispositions/funnel/recent-calls to
   *  (e.g. 7 = last 7 days). null ⇒ all-time (default; unchanged for callers
   *  that don't pass it). The 7d/30d trend and today's hourly chart always
   *  keep their own fixed windows regardless of this param. */
  rangeDays: number | null = null,
  opts: {
    /**
     * Shift the ranged period back by this many days — the comparison-period
     * hook: `getReportingData(7, { periodOffsetDays: 7 })` is "the 7 days
     * BEFORE the current 7". Only the period figures move; today's tiles and
     * the fixed trends stay anchored to now. Ignored when rangeDays is null
     * (all time has no previous period).
     */
    periodOffsetDays?: number;
  } = {},
): Promise<ReportingData> {
  if (!isSupabaseConfigured()) return fallbackReporting();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fallbackReporting();

    // End + categorize any stuck calls first (bounded so a slow provider can't
    // hang the render), so live counts and dispositions are accurate the moment
    // the dashboard / reports load. This ALSO returns the live monitor feed, so
    // we don't fetch it a second time below — one getAIConversationsForMonitor
    // per load instead of two.
    const monitor = await reconcileAndGetMonitor();

    // Scope: supervisors (manager/admin/owner) see the whole org; reps see their
    // own. Org-wide reads use the service-role client (RLS would otherwise hide
    // other reps' rows), scoped to the org in app code.
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name,avatar_color,org_id,role")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const supervisor = Boolean(
      orgId &&
        ["owner", "admin", "manager"].includes(String(prof?.role ?? "rep")) &&
        isAdminConfigured(),
    );
    const reader = supervisor ? createAdminClient() : supabase;
    const scopeCol = supervisor ? "org_id" : "owner_id";
    const scopeVal = (supervisor ? orgId : user.id) as string;
    // A rep's "own" scope must stay within their CURRENT org — never surface
    // calls/appointments/leads they happen to own from an org they've since
    // left (matters most right after joining/creating a fresh org).
    const ownScoped = !supervisor && orgId;

    // How far back the ROW fetch reaches. Row-based views (dispositions, funnel,
    // avg talk, trends) are computed in JS from these rows, so the window must
    // cover both the selected range (shifted back for a comparison period) and
    // the fixed 30-day trend. All-time (null) pages the whole history. The +1
    // day of slack keeps the org-tz day-key filter below from clipping the
    // boundary day; that filter does the precise per-day scoping — this bound
    // is only a coarse floor to keep the fetch small.
    const offsetDays =
      rangeDays && rangeDays > 0 ? Math.max(0, Math.floor(opts.periodOffsetDays ?? 0)) : 0;
    const windowDays =
      rangeDays && rangeDays > 0 ? Math.max(rangeDays + offsetDays, 30) : null;
    const callsSinceISO = windowDays
      ? new Date(Date.now() - (windowDays + 1) * DAY_MS).toISOString()
      : null;

    const [calls, appts, leadAgg, memberRes, orgRes] = await Promise.all([
      fetchPaged((from, to) => {
        let q = reader
          .from("call_records")
          .select(
            "id,owner_id,outcome,duration_sec,human_connected,talk_sec,channel,started_at,lead_name,phone,conversation_id,recording_url,summary",
          )
          .eq(scopeCol, scopeVal);
        if (ownScoped) q = q.eq("org_id", orgId as string);
        if (callsSinceISO) q = q.gte("started_at", callsSinceISO);
        return q.order("started_at", { ascending: false }).range(from, to);
      }, "call_records"),
      fetchPaged((from, to) => {
        // Appointments are low-volume and feed both the range-scoped "booked"
        // count and the all-time upcoming list, so page them all.
        let q = reader
          .from("appointments")
          .select("id,status,source,lead_name,scheduled_label,scheduled_at,created_at")
          .eq(scopeCol, scopeVal);
        if (ownScoped) q = q.eq("org_id", orgId as string);
        return q.order("created_at", { ascending: false }).range(from, to);
      }, "appointments"),
      (async () => {
        // Leads feed the $ averages + EV/pool/battery ownership. Ownership % is now
        // EXACT — head:true COUNT queries over the WHOLE book (no rows transferred,
        // no truncation, no biased subset) — instead of dividing by the length of a
        // capped, unordered 20k-row pull that both under-sampled big books and
        // shipped megabytes per load. The $ averages come from a small,
        // deterministically-ordered recent sample (stable across loads).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const countWhere = async (apply?: (q: any) => any): Promise<number> => {
          let q = reader
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq(scopeCol, scopeVal);
          if (ownScoped) q = q.eq("org_id", orgId as string);
          if (apply) q = apply(q);
          const { count } = await q;
          return count ?? 0;
        };
        const sampleQ = (() => {
          let q = reader
            .from("leads")
            .select("utility_bill,solar_payment")
            .eq(scopeCol, scopeVal);
          if (ownScoped) q = q.eq("org_id", orgId as string);
          return q.order("created_at", { ascending: false }).limit(5000);
        })();
        const [total, ev, pool, battery, sample] = await Promise.all([
          countWhere(),
          countWhere((q) => q.eq("has_ev", true)),
          countWhere((q) => q.eq("has_pool", true)),
          countWhere((q) => q.eq("has_battery", true)),
          sampleQ,
        ]);
        const rows = ((sample as { data?: Row[] }).data ?? []) as Row[];
        const bills = rows.map((r) => Number(r.utility_bill ?? 0)).filter((n) => n > 0);
        const solars = rows.map((r) => Number(r.solar_payment ?? 0)).filter((n) => n > 0);
        return {
          avgUtilityBill: avg(bills),
          avgSolarPayment: avg(solars),
          evOwnership: pct(ev, total),
          poolOwnership: pct(pool, total),
          batteryOwnership: pct(battery, total),
        };
      })(),
      supervisor && orgId
        ? createAdminClient()
            .from("organization_members")
            .select("user_id,name")
            .eq("org_id", orgId)
            .eq("status", "active")
        : Promise.resolve({ data: [] as Row[] }),
      // Org timezone drives every "day" boundary below (today, hourly, trend
      // buckets, the range cutoff) — a server-local (UTC) boundary rolls
      // "today" over at the wrong wall-clock hour for any non-UTC org.
      orgId
        ? supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle()
        : Promise.resolve({ data: null as { timezone?: string } | null }),
    ]);

    const nameById = new Map(
      ((memberRes.data ?? []) as Row[]).map((m) => [String(m.user_id), String(m.name ?? "")]),
    );
    // The ONE timezone fallback (America/Chicago) — same as the dialing/TCPA
    // path, so "today" can't roll over at a different hour than dialing windows.
    const timezone = orgTimezone(orgRes.data);

    const outcomeOf = (r: Row) => (r.outcome as CallOutcome) ?? null;

    // Precompute each call's org-local day key ONCE. The trend, "today", and
    // period passes below would otherwise each re-derive it per row — ~37 passes
    // over the whole fetched history for a supervisor. One O(rows) pass here
    // (with the memoized formatter from schedule.ts) replaces all of them.
    const callCount = calls.length;
    const callDayKey: (string | null)[] = new Array(callCount);
    for (let i = 0; i < callCount; i++) {
      const ts = calls[i].started_at;
      callDayKey[i] = ts ? zonedDayKey(new Date(String(ts)), timezone) : null;
    }

    // Bucket calls by org-local day once so the 7d/30d trend series become
    // O(days) map lookups instead of O(rows × days) re-filters.
    type DayAgg = { calls: number; conv: number; appts: number };
    const dayAgg = new Map<string, DayAgg>();
    for (let i = 0; i < callCount; i++) {
      const key = callDayKey[i];
      if (!key) continue;
      let a = dayAgg.get(key);
      if (!a) {
        a = { calls: 0, conv: 0, appts: 0 };
        dayAgg.set(key, a);
      }
      const c = calls[i];
      a.calls++;
      if (isConnected(c)) a.conv++;
      if (outcomeOf(c) === "appointment_booked") a.appts++;
    }

    // Optional date-range scope for the "period" figures (KPIs, dispositions,
    // funnel, channel split, recent calls). The 7d/30d trend + today's hourly
    // chart keep their own fixed windows. Compared by day-KEY (YYYY-MM-DD,
    // lexicographically sortable) in the org's timezone rather than a raw
    // Date boundary, so the cutoff lands on the org's own calendar day.
    // With periodOffsetDays the same-length window slides back — the range
    // becomes [today − (offset + range − 1), today − offset], which is exactly
    // "the previous period" when offset === rangeDays.
    const dayKeyAgo = (daysBack: number) => {
      const d = new Date();
      d.setDate(d.getDate() - daysBack);
      return zonedDayKey(d, timezone);
    };
    const rangeStartKey =
      rangeDays && rangeDays > 0 ? dayKeyAgo(offsetDays + rangeDays - 1) : null;
    const rangeEndKey = rangeDays && rangeDays > 0 && offsetDays > 0 ? dayKeyAgo(offsetDays) : null;
    const inPeriod = (k: string | null): boolean =>
      k !== null &&
      (rangeStartKey === null || k >= rangeStartKey) &&
      (rangeEndKey === null || k <= rangeEndKey);
    const periodCalls = rangeStartKey
      ? calls.filter((_c, i) => inPeriod(callDayKey[i]))
      : calls;

    // "Today" is evaluated in the org's own timezone — a server-local (UTC)
    // boundary rolls "today" over at the wrong wall-clock hour for any
    // non-UTC org, miscategorizing evening calls into the wrong day.
    const todayKey = zonedDayKey(new Date(), timezone);

    // ── Counts (period-scoped) ──────────────────────────────────────────────
    const totalCalls = periodCalls.length;
    const connections = periodCalls.filter(isConnected).length;
    const byOutcome = {} as Record<CallOutcome, number>;
    for (const c of periodCalls) {
      const o = outcomeOf(c);
      if (o) byOutcome[o] = (byOutcome[o] ?? 0) + 1;
    }
    const apptOutcome = byOutcome.appointment_booked ?? 0;
    const callbackOutcome = byOutcome.callback_scheduled ?? 0;
    const noAnswerOutcome = (byOutcome.no_answer ?? 0) + (byOutcome.voicemail ?? 0);

    // Today's calls stay anchored to today (callsToday KPI + hourly chart),
    // independent of the selected range.
    const todays = calls.filter((_c, i) => callDayKey[i] === todayKey);
    // The dashboard hero shows "Calls today" beside a connect rate; that rate was
    // all-time, so a rep with a great day but a mediocre lifetime saw a number
    // that contradicted the count next to it. Give the dashboard TODAY's rate.
    const connectRateToday = pct(todays.filter(isConnected).length, todays.length);
    // Avg talk time (glossary: avg_talk_time) — CONNECTED calls only, preferring
    // the measured connected→ended talk_sec and falling back to duration_sec on
    // legacy rows. Averaging every row's duration (the old math) let ringing and
    // voicemail seconds drag the number toward zero.
    const talkSecs = periodCalls
      .filter(isConnected)
      .map((c) => Number(c.talk_sec ?? c.duration_sec ?? 0));

    // Appointments "booked" reacts to the selected range too (created_at in the
    // org's day window), so Reports(Today) no longer shows "5 calls / 340 appts".
    // Still sourced from the appointments TABLE (not funnel outcomes) so it agrees
    // with the Dashboard + calendar; the Dashboard passes all-time (unchanged).
    const periodAppts = rangeStartKey
      ? appts.filter(
          (a) =>
            a.created_at &&
            inPeriod(zonedDayKey(new Date(String(a.created_at)), timezone)),
        )
      : appts;

    const { avgUtilityBill, avgSolarPayment } = leadAgg;

    const metrics: MetricSummary = {
      totalCalls,
      callsToday: todays.length,
      connections,
      conversations: connections,
      avgCallLenSec: avg(talkSecs),
      connectRate: pct(connections, totalCalls),
      appointmentRate: pct(apptOutcome, totalCalls),
      callbackRate: pct(callbackOutcome, totalCalls),
      noAnswerRate: pct(noAnswerOutcome, totalCalls),
      // "Booked" = still on the books. Superseded appointments are CANCELLED now
      // rather than hard-deleted (routeDisposition, db/records.ts) so the calendar
      // keeps its history — but a review the rep re-dispositioned away was never a
      // booking, and counting it here would quietly inflate every report the day
      // that change shipped. Excluding cancelled reproduces the old count exactly.
      appointmentsBooked: periodAppts.filter((a) => !isCancelledAppointment(a.status == null ? null : String(a.status)))
        .length,
      appointmentsCompleted: periodAppts.filter((a) => a.status === "completed").length,
      noShows: periodAppts.filter((a) => a.status === "no_show").length,
      reschedules: periodAppts.filter((a) => a.status === "rescheduled").length,
      avgUtilityBill,
      avgSolarPayment,
      avgTotalEnergyCost: avgUtilityBill + avgSolarPayment,
      evOwnership: leadAgg.evOwnership,
      poolOwnership: leadAgg.poolOwnership,
      batteryOwnership: leadAgg.batteryOwnership,
    };

    // ── Trends (7-day weekday view + 30-day view) — bucketed by org-local day ──
    const buildSeries = (days: number): KpiPoint[] => {
      const out: KpiPoint[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayKey = zonedDayKey(d, timezone);
        const a = dayAgg.get(dayKey);
        const dayCalls = a?.calls ?? 0;
        const conv = a?.conv ?? 0;
        out.push({
          label: d.toLocaleDateString(
            "en-US",
            days > 10 ? { month: "numeric", day: "numeric" } : { weekday: "short" },
          ),
          calls: dayCalls,
          conversations: conv,
          appointments: a?.appts ?? 0,
          connectRate: Math.round(pct(conv, dayCalls)),
        });
      }
      return out;
    };
    const kpiSeries = buildSeries(7);
    const trend30 = buildSeries(30);

    // ── Hourly (today, business window, org-local hour) ─────────────────────────
    const hourlyCalls: { hour: string; calls: number; connects: number }[] = [];
    for (let h = 8; h <= 18; h++) {
      const inHour = todays.filter(
        (c) =>
          c.started_at && zonedDayHour(new Date(String(c.started_at)), timezone).hour === h,
      );
      hourlyCalls.push({
        hour: fmtHour(h),
        calls: inHour.length,
        connects: inHour.filter(isConnected).length,
      });
    }

    // ── Dispositions (all of them), channel split, funnel — period-scoped ───────
    const dispositions = dispositionBreakdown(periodCalls);
    const channelStats = channelBreakdown(periodCalls);
    const funnel = funnelOf(periodCalls);
    const outcomeBreakdown = dispositions
      .filter((d) => d.count > 0)
      .map((d) => ({ name: d.label, value: Math.round(d.rate), color: d.color }));

    // ── Recent calls (period-scoped) ────────────────────────────────────────────
    const recentCalls: RecentCall[] = periodCalls
      .slice(0, supervisor ? 25 : 12)
      .map((r) => mapRecentCall(r, supervisor, nameById));

    // ── Pipeline + live ─────────────────────────────────────────────────────────
    // Cancelled reviews are dead weight in the dashboard's upcoming list — and
    // they'd eat the 30 slots the live ones need.
    const appointments: ApptLite[] = appts
      .filter((a) => !isCancelledAppointment(a.status == null ? null : String(a.status)))
      .slice(0, 30)
      .map((a, i) => ({
        id: String(a.id ?? i),
        leadName: String(a.lead_name ?? "").trim(),
        whenLabel: apptWhen(a, timezone),
        source: String(a.source ?? "ai"),
        status: String(a.status ?? "scheduled"),
      }));

    const liveCutoff = Date.now() - 20 * 60_000;
    const liveCalls: LiveCall[] = monitor.active
      .filter((c) => c.startedAt >= liveCutoff)
      .map((c) => ({
        id: c.conversationId,
        leadName: c.leadName,
        city: c.city,
        state: c.state,
      }));

    return {
      metrics,
      kpiSeries,
      trend30,
      hourlyCalls,
      outcomeBreakdown,
      dispositions,
      channelStats,
      funnel,
      recentCalls,
      liveCalls,
      appointments,
      connectRateToday,
      scope: supervisor ? "org" : "own",
    };
  } catch (e) {
    console.error("[metrics] getReportingData failed:", e instanceof Error ? e.message : e);
    // We got here AFTER isSupabaseConfigured() passed, so Supabase IS configured
    // and this is a real query failure — return an empty (not demo) result so a
    // transient error never paints fabricated sample numbers over live data.
    return emptyReporting();
  }
}

/** Zeroed-but-valid reporting — used when a configured Supabase query throws, so
 *  the UI shows an honest empty state instead of demo data. */
function emptyReporting(): ReportingData {
  const empty: Row[] = [];
  return {
    metrics: {
      totalCalls: 0, callsToday: 0, connections: 0, conversations: 0,
      avgCallLenSec: 0, connectRate: 0, appointmentRate: 0, callbackRate: 0,
      noAnswerRate: 0, appointmentsBooked: 0, appointmentsCompleted: 0,
      noShows: 0, reschedules: 0, avgUtilityBill: 0, avgSolarPayment: 0,
      avgTotalEnergyCost: 0, evOwnership: 0, poolOwnership: 0, batteryOwnership: 0,
    },
    kpiSeries: [],
    trend30: [],
    hourlyCalls: [],
    outcomeBreakdown: [],
    dispositions: dispositionBreakdown(empty),
    channelStats: channelBreakdown(empty),
    funnel: funnelOf(empty),
    recentCalls: [],
    liveCalls: [],
    appointments: [],
    connectRateToday: 0,
    scope: "own",
  };
}

// ── Demo / empty fallback (bundled data module) ──────────────────────────────
function fallbackReporting(): ReportingData {
  const demoRows = sampleRecords.map((r) => ({
    outcome: r.outcome,
    duration_sec: r.durationSec,
    channel: "human",
  }));
  return {
    metrics: sampleMetrics,
    kpiSeries: sampleKpi,
    trend30: sampleKpi,
    hourlyCalls: sampleHourly,
    outcomeBreakdown: sampleOutcomes,
    dispositions: dispositionBreakdown(demoRows),
    channelStats: channelBreakdown(demoRows),
    funnel: funnelOf(demoRows),
    connectRateToday: sampleMetrics.connectRate,
    scope: "own",
    recentCalls: sampleRecords.map((r) => ({
      id: r.id,
      leadName: r.leadName,
      channel: "human",
      repName: r.repName,
      outcome: r.outcome,
      durationSec: r.durationSec,
      startedAt: r.startedAt,
      recordingUrl: r.recordingUrl ?? null,
      conversationId: null,
      hasSummary: r.hasSummary,
      hasRecording: Boolean(r.recordingUrl),
    })),
    liveCalls: sampleActive.map((c) => ({
      id: c.id,
      leadName: c.leadName,
      city: c.leadCity,
      // Demo mode must show the same four states as production — a ringing sample
      // call used to collapse to "initiated", so the demo couldn't tell "Calling"
      // from "Ringing" either.
      state: (c.state === "connected"
        ? "in_progress"
        : c.state === "ringing"
          ? "ringing"
          : "initiated") as AILiveState,
    })),
    appointments: sampleAppts.map((a) => ({
      id: a.id,
      leadName: a.leadName,
      whenLabel: new Date(a.scheduledAt).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      source: a.source,
      status: a.status,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Org-wide team leaderboard v2. Aggregates EVERY active member's real call,
// appointment, and callback rows over three CALENDAR-TRUE windows (org-tz day /
// calendar week / calendar month) through the org's own scoring config
// (settings.leaderboard). Reads via the service-role client scoped to the
// viewer's org in app code (any member can see the team ranking, even though
// RLS would otherwise hide other reps' rows). Falls back to a demo team — run
// through the SAME composition, so demo numbers obey the same math — when
// Supabase / the service role isn't configured.
// The pure composition lives in ../leaderboard (composeLeaderboard).
// ─────────────────────────────────────────────────────────────────────────────

/** One member with stats for all three calendar periods + streak/PB. */
export interface TeamLeaderboardRep {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  role: string;
  team: string;
  daily: LeaderboardPeriodStat;
  weekly: LeaderboardPeriodStat;
  monthly: LeaderboardPeriodStat;
  streakDays: number;
  personalBestPoints: number;
  personalBestDay: string | null;
}

export interface TeamLeaderboard {
  reps: TeamLeaderboardRep[];
  meId: string | null;
  periods: {
    daily: LeaderboardPeriodMeta;
    weekly: LeaderboardPeriodMeta;
    monthly: LeaderboardPeriodMeta;
  };
  config: LeaderboardSettings;
  timezone: string;
  /** Render time — the "data as of" stamp for the board. */
  generatedAt: string;
}

/** Streaks + personal best need history beyond the month — fetch this window. */
const LEADERBOARD_FETCH_DAYS = 90;

/** Compose the three calendar boards and fold them into per-rep rows. */
function composeTeamBoards(
  rows: Row[],
  members: LeaderboardMember[],
  config: LeaderboardSettings,
  timezone: string,
  opts: { appointments?: Row[]; callbacks?: Row[]; now?: number } = {},
): Omit<TeamLeaderboard, "meId"> {
  const now = opts.now ?? Date.now();
  const shared = { tz: timezone, now, appointments: opts.appointments, callbacks: opts.callbacks };
  const boards: Record<"daily" | "weekly" | "monthly", ComposedBoard> = {
    daily: composeLeaderboard(rows, members, config, { period: "daily", ...shared }),
    weekly: composeLeaderboard(rows, members, config, { period: "weekly", ...shared }),
    monthly: composeLeaderboard(rows, members, config, { period: "monthly", ...shared }),
  };
  const daily = new Map(boards.daily.entries.map((e) => [e.id, e]));
  const monthly = new Map(boards.monthly.entries.map((e) => [e.id, e]));
  // Rep order = the weekly ranking (the view's default period); the client
  // re-sorts per its own period/rank-by controls with the same comparator.
  const reps: TeamLeaderboardRep[] = boards.weekly.entries.map((w) => {
    const d = daily.get(w.id)!;
    const m = monthly.get(w.id)!;
    return {
      id: w.id,
      name: w.name,
      initials: w.initials,
      avatarColor: w.avatarColor,
      role: w.role,
      team: w.team,
      daily: d.stat,
      weekly: w.stat,
      monthly: m.stat,
      streakDays: w.streakDays,
      personalBestPoints: w.personalBestPoints,
      personalBestDay: w.personalBestDay,
    };
  });
  return {
    reps,
    periods: {
      daily: boards.daily.period,
      weekly: boards.weekly.period,
      monthly: boards.monthly.period,
    },
    config,
    timezone,
    generatedAt: new Date(now).toISOString(),
  };
}

/** Valid-but-empty board (config/periods intact so headers still render). */
function emptyTeamLeaderboard(
  config: LeaderboardSettings,
  timezone: string,
  meId: string | null,
): TeamLeaderboard {
  return { ...composeTeamBoards([], [], config, timezone), meId };
}

async function aggregateTeamLeaderboard(
  orgId: string,
  timezone: string,
  config: LeaderboardSettings,
): Promise<Omit<TeamLeaderboard, "meId">> {
  // Missing service-role key is a DISTINCT condition from "no data yet" — it
  // means the leaderboard can never populate for this org until it's set, not
  // that no one has dialed. Logged so that's diagnosable instead of reading as
  // a silently-permanent empty state.
  if (!isAdminConfigured()) {
    console.error(
      "[metrics] aggregateTeamLeaderboard: SUPABASE_SERVICE_ROLE_KEY not configured — " +
        "the team leaderboard cannot be computed.",
    );
    return composeTeamBoards([], [], config, timezone);
  }
  const admin = createAdminClient();

  const { data: memberRows, error: memberErr } = await admin
    .from("organization_members")
    .select("user_id,name,role")
    .eq("org_id", orgId)
    .eq("status", "active");
  if (memberErr) {
    console.error("[metrics] aggregateTeamLeaderboard members query failed:", memberErr.message);
    return composeTeamBoards([], [], config, timezone);
  }
  const memberRaw = (memberRows ?? []) as Row[];
  if (!memberRaw.length) return composeTeamBoards([], [], config, timezone);
  const ids = memberRaw.map((m) => String(m.user_id));

  const since = new Date(Date.now() - LEADERBOARD_FETCH_DAYS * 86_400_000).toISOString();
  // PAGE the call_records to completion — the SAME guarantee getReportingData
  // uses. A single `.limit(50000)` returns only PostgREST's first 1,000 rows per
  // request, so a high-volume floor's leaderboard was computed from ~1k of ~45k
  // calls while Reports (fetchPaged) saw all of them — the two surfaces silently
  // disagreed. fetchPaged orders newest-first, so a ceiling hit drops oldest,
  // never a random subset. human_connected + talk_sec ride along so the connect
  // gate uses the same canonical predicate as every other surface.
  const [{ data: profRows, error: profErr }, callRows, apptRows, cbRows] = await Promise.all([
    admin.from("profiles").select("id,full_name,avatar_color,team").in("id", ids),
    fetchPaged(
      (from, to) =>
        admin
          .from("call_records")
          .select("owner_id,outcome,duration_sec,talk_sec,human_connected,channel,started_at")
          .eq("org_id", orgId)
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .range(from, to),
      "leaderboard call_records",
    ),
    // appointmentKept = appointments the rep actually HELD (status completed).
    fetchPaged(
      (from, to) =>
        admin
          .from("appointments")
          .select("owner_id,status,created_at")
          .eq("org_id", orgId)
          .eq("status", "completed")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .range(from, to),
      "leaderboard appointments",
    ),
    // callbackCompleted — completion is stamped on last_attempt_at
    // (completeCallbackForLead in db/callbacks.ts) and credited to assigned_to.
    fetchPaged(
      (from, to) =>
        admin
          .from("callbacks")
          .select("owner_id,assigned_to,status,last_attempt_at,created_at")
          .eq("org_id", orgId)
          .eq("status", "completed")
          .gte("last_attempt_at", since)
          .order("last_attempt_at", { ascending: false })
          .range(from, to),
      "leaderboard callbacks",
    ),
  ]);
  if (profErr) console.error("[metrics] aggregateTeamLeaderboard profiles query failed:", profErr.message);
  const profById = new Map(((profRows ?? []) as Row[]).map((p) => [String(p.id), p]));
  const members: LeaderboardMember[] = memberRaw.map((m) => {
    const prof = profById.get(String(m.user_id));
    return {
      userId: String(m.user_id),
      name: String(prof?.full_name || m.name || "Member"),
      role: String(m.role || "rep"),
      // Empty when unset — Avatar's seed prop then hash-picks a chart tone.
      avatarColor: String(prof?.avatar_color || ""),
      team: String(prof?.team || ""),
    };
  });
  return composeTeamBoards(callRows, members, config, timezone, {
    appointments: apptRows,
    callbacks: cbRows,
  });
}

/** The org-wide leaderboard for the current viewer's organization, + their id. */
export async function getTeamLeaderboard(): Promise<TeamLeaderboard> {
  if (!isSupabaseConfigured()) return fallbackLeaderboard();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fallbackLeaderboard();
    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    if (!orgId) return emptyTeamLeaderboard(DEFAULT_LEADERBOARD, "America/Chicago", user.id);
    const { data: org } = await supabase
      .from("organizations")
      .select("timezone,settings")
      .eq("id", orgId)
      .maybeSingle();
    // Same org-timezone fallback as every other surface (America/Chicago) — a
    // UTC fallback here rolled the leaderboard's "today" over at the wrong hour.
    const timezone = orgTimezone(org);
    // The org's own scoring config, sanitized on read.
    const config = mergeLeaderboardSettings(
      (org?.settings as { leaderboard?: unknown } | null | undefined)?.leaderboard,
    );
    return { ...(await aggregateTeamLeaderboard(orgId, timezone, config)), meId: user.id };
  } catch (e) {
    console.error("[metrics] getTeamLeaderboard failed:", e instanceof Error ? e.message : e);
    // Supabase is configured (checked above) — a thrown query is a real failure,
    // so return an empty board rather than the demo team over live data.
    return emptyTeamLeaderboard(DEFAULT_LEADERBOARD, "America/Chicago", null);
  }
}

/**
 * Demo team leaderboard (no Supabase). The sample reps are expanded into
 * synthetic per-day call rows and run through the REAL composition — the demo
 * board can therefore never disagree with production math (points, breakdowns,
 * calendar windows, streaks all come from composeLeaderboard itself).
 */
function fallbackLeaderboard(): TeamLeaderboard {
  const timezone = "America/Chicago";
  const now = Date.now();
  const rows: Row[] = [];
  const members: LeaderboardMember[] = sampleLeaderboard.map((r) => ({
    userId: r.id,
    name: r.name,
    role: r.role,
    avatarColor: r.avatarColor,
    team: r.team,
  }));
  for (const r of sampleLeaderboard) {
    // Two weeks of history — enough for the week/month boards, streaks and
    // personal bests to light up without composing 30k synthetic rows per render.
    for (let d = 0; d < 14; d++) {
      const dayStart = now - d * 86_400_000;
      const talkPerConnect = Math.max(
        60,
        Math.round((r.talkTimeMin * 60) / Math.max(1, r.conversationsToday)),
      );
      for (let i = 0; i < r.callsToday; i++) {
        const isAppt = i < r.appointmentsToday;
        const isConn = i < r.conversationsToday;
        rows.push({
          owner_id: r.id,
          outcome: isAppt ? "appointment_booked" : isConn ? "qualified" : "no_answer",
          duration_sec: isConn ? talkPerConnect : 0,
          channel: "human",
          started_at: new Date(dayStart - i * 60_000).toISOString(),
        });
      }
    }
  }
  return {
    ...composeTeamBoards(rows, members, DEFAULT_LEADERBOARD, timezone, { now }),
    meId: null,
  };
}
