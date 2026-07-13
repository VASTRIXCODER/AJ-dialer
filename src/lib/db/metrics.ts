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
import { reconcileOwnerActiveCalls } from "../ai-call-reconcile";
import {
  channelBreakdown,
  CONNECTED_OUTCOMES,
  dispositionBreakdown,
  funnelOf,
  isConnectedRow,
  type ChannelRow,
  type DispositionRow,
  type Funnel,
} from "../call-analytics";
import { zonedDayHour, zonedDayKey } from "../dialer/schedule";
import { composeLeaderboard } from "../leaderboard";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type {
  AILiveState,
  CallOutcome,
  KpiPoint,
  LeaderboardEntry,
  LeaderboardStat,
  MetricSummary,
} from "../types";
import { getAIConversationsForMonitor } from "./records";

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

/** Map one call_records row to the RecentCall shape (recording + transcript aware). */
function mapRecentCall(
  r: Row,
  supervisor: boolean,
  nameById: Map<string, string>,
): RecentCall {
  const outcome = (r.outcome as CallOutcome) ?? null;
  const channel = r.channel === "human" ? "human" : "ai";
  const recordingUrl =
    channel === "human"
      ? toPlayableRecording((r.recording_url as string) ?? null)
      : ((r.recording_url as string) ?? null);
  const conversationId = (r.conversation_id as string) ?? null;
  const summary = (r.summary as string) ?? null;
  // A recording only exists when the call actually connected — no-answer /
  // voicemail / failed calls have none, so don't offer a dead "Play" link.
  const hasRecording =
    channel === "human"
      ? Boolean(recordingUrl)
      : Boolean(conversationId && outcome && CONNECTED_OUTCOMES.has(outcome));
  return {
    id: String(r.id ?? conversationId ?? `${r.owner_id}-${r.started_at}`),
    leadName: String(r.lead_name ?? "Homeowner"),
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
    const { data, error } = await reader
      .from("call_records")
      .select(
        "id,owner_id,outcome,duration_sec,channel,started_at,lead_name,phone,conversation_id,recording_url,summary",
      )
      .eq(scopeCol, scopeVal)
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
  /** "org" when the viewer is a supervisor (team-wide) else "own". */
  scope: "org" | "own";
}

type Row = Record<string, unknown>;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const avg = (a: number[]) =>
  a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

function fmtHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function apptWhen(a: Row): string {
  const label = a.scheduled_label ? String(a.scheduled_label) : "";
  if (label) return label;
  if (a.scheduled_at) {
    return new Date(String(a.scheduled_at)).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return a.created_at
    ? new Date(String(a.created_at)).toLocaleDateString()
    : "Scheduled";
}

export async function getReportingData(
  /** Optional day count to scope KPIs/dispositions/funnel/recent-calls to
   *  (e.g. 7 = last 7 days). null ⇒ all-time (default; unchanged for callers
   *  that don't pass it). The 7d/30d trend and today's hourly chart always
   *  keep their own fixed windows regardless of this param. */
  rangeDays: number | null = null,
): Promise<ReportingData> {
  if (!isSupabaseConfigured()) return fallbackReporting();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fallbackReporting();

    // End + categorize any stuck calls first, so live counts and dispositions
    // are accurate the moment the dashboard / reports load.
    await reconcileOwnerActiveCalls();

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

    const [callsRes, apptsRes, leadsRes, monitor, memberRes, orgRes] = await Promise.all([
      reader
        .from("call_records")
        .select(
          "id,owner_id,outcome,duration_sec,channel,started_at,lead_name,phone,conversation_id,recording_url,summary",
        )
        .eq(scopeCol, scopeVal)
        .order("started_at", { ascending: false })
        .limit(supervisor ? 20000 : 2000),
      reader
        .from("appointments")
        .select("id,status,source,lead_name,scheduled_label,scheduled_at,created_at")
        .eq(scopeCol, scopeVal)
        .order("created_at", { ascending: false })
        .limit(supervisor ? 5000 : 500),
      reader
        .from("leads")
        .select("utility_bill,solar_payment,has_ev,has_pool,has_battery")
        .eq(scopeCol, scopeVal)
        .limit(supervisor ? 50000 : 5000),
      getAIConversationsForMonitor(),
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

    // Errors here would otherwise silently coerce to an empty array below,
    // rendering as "no activity yet" — indistinguishable from a genuinely new
    // account. Log so a real fetch failure is at least visible server-side.
    if (callsRes.error)
      console.error("[metrics] getReportingData call_records query failed:", callsRes.error.message);
    if (apptsRes.error)
      console.error("[metrics] getReportingData appointments query failed:", apptsRes.error.message);
    if (leadsRes.error)
      console.error("[metrics] getReportingData leads query failed:", leadsRes.error.message);

    const calls = (callsRes.data ?? []) as Row[];
    const appts = (apptsRes.data ?? []) as Row[];
    const leads = (leadsRes.data ?? []) as Row[];
    const nameById = new Map(
      ((memberRes.data ?? []) as Row[]).map((m) => [String(m.user_id), String(m.name ?? "")]),
    );
    const timezone = (orgRes.data?.timezone as string) || "UTC";

    const outcomeOf = (r: Row) => (r.outcome as CallOutcome) ?? null;
    const isConnected = isConnectedRow;

    // Optional date-range scope for the "period" figures (KPIs, dispositions,
    // funnel, channel split, recent calls). The 7d/30d trend + today's hourly
    // chart keep their own fixed windows. Compared by day-KEY (YYYY-MM-DD,
    // lexicographically sortable) in the org's timezone rather than a raw
    // Date boundary, so the cutoff lands on the org's own calendar day.
    const rangeStartKey =
      rangeDays && rangeDays > 0
        ? (() => {
            const d = new Date();
            d.setDate(d.getDate() - (rangeDays - 1));
            return zonedDayKey(d, timezone);
          })()
        : null;
    const periodCalls = rangeStartKey
      ? calls.filter(
          (c) =>
            c.started_at &&
            zonedDayKey(new Date(String(c.started_at)), timezone) >= rangeStartKey,
        )
      : calls;

    // "Today" is evaluated in the org's own timezone — a server-local (UTC)
    // boundary rolls "today" over at the wrong wall-clock hour for any
    // non-UTC org, miscategorizing evening calls into the wrong day.
    const todayKey = zonedDayKey(new Date(), timezone);
    const onDay = (r: Row, field = "started_at") =>
      r[field] ? zonedDayKey(new Date(String(r[field])), timezone) === todayKey : false;

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
    const todays = calls.filter((c) => onDay(c));
    const durations = periodCalls
      .map((c) => Number(c.duration_sec ?? 0))
      .filter((n) => n > 0);

    const bills = leads.map((l) => Number(l.utility_bill ?? 0)).filter((n) => n > 0);
    const solars = leads.map((l) => Number(l.solar_payment ?? 0)).filter((n) => n > 0);
    const avgUtilityBill = avg(bills);
    const avgSolarPayment = avg(solars);

    const metrics: MetricSummary = {
      totalCalls,
      callsToday: todays.length,
      connections,
      conversations: connections,
      avgCallLenSec: avg(durations),
      connectRate: pct(connections, totalCalls),
      appointmentRate: pct(apptOutcome, totalCalls),
      callbackRate: pct(callbackOutcome, totalCalls),
      noAnswerRate: pct(noAnswerOutcome, totalCalls),
      appointmentsBooked: appts.length,
      appointmentsCompleted: appts.filter((a) => a.status === "completed").length,
      noShows: appts.filter((a) => a.status === "no_show").length,
      reschedules: appts.filter((a) => a.status === "rescheduled").length,
      avgUtilityBill,
      avgSolarPayment,
      avgTotalEnergyCost: avgUtilityBill + avgSolarPayment,
      evOwnership: pct(leads.filter((l) => l.has_ev).length, leads.length),
      poolOwnership: pct(leads.filter((l) => l.has_pool).length, leads.length),
      batteryOwnership: pct(leads.filter((l) => l.has_battery).length, leads.length),
    };

    // ── Trends (7-day weekday view + 30-day view) — bucketed by org-local day ──
    const buildSeries = (days: number): KpiPoint[] => {
      const out: KpiPoint[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayKey = zonedDayKey(d, timezone);
        const dayCalls = calls.filter(
          (c) =>
            c.started_at && zonedDayKey(new Date(String(c.started_at)), timezone) === dayKey,
        );
        const conv = dayCalls.filter(isConnected).length;
        out.push({
          label: d.toLocaleDateString(
            "en-US",
            days > 10 ? { month: "numeric", day: "numeric" } : { weekday: "short" },
          ),
          calls: dayCalls.length,
          conversations: conv,
          appointments: dayCalls.filter((c) => outcomeOf(c) === "appointment_booked").length,
          connectRate: Math.round(pct(conv, dayCalls.length)),
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
    const appointments: ApptLite[] = appts.slice(0, 30).map((a, i) => ({
      id: String(a.id ?? i),
      leadName: String(a.lead_name ?? "Homeowner"),
      whenLabel: apptWhen(a),
      source: String(a.source ?? "ai"),
      status: String(a.status ?? "scheduled"),
    }));

    const liveCutoff = Date.now() - 20 * 60_000;
    const liveCalls: LiveCall[] = monitor.active
      .filter((c) => c.startedAt >= liveCutoff)
      .map((c) => ({
        id: c.conversationId,
        leadName: c.leadName || "Homeowner",
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
      scope: supervisor ? "org" : "own",
    };
  } catch (e) {
    console.error("[metrics] getReportingData failed:", e instanceof Error ? e.message : e);
    return fallbackReporting();
  }
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
// Org-wide team leaderboard. Aggregates EVERY active member's real call +
// appointment stats over three windows (today / 7d / 30d) so the leaderboard
// ranks the whole floor, not just the signed-in user. Reads via the service-role
// client scoped to the viewer's org in app code (any member can see the team
// ranking, even though RLS would otherwise hide other reps' rows). Falls back to
// the bundled demo team when Supabase / the service role isn't configured.
// The pure aggregation lives in ../leaderboard (composeLeaderboard).
// ─────────────────────────────────────────────────────────────────────────────

async function aggregateTeamLeaderboard(
  orgId: string,
  timezone: string,
): Promise<LeaderboardEntry[]> {
  // Missing service-role key is a DISTINCT condition from "no data yet" — it
  // means the leaderboard can never populate for this org until it's set, not
  // that no one has dialed. Logged so that's diagnosable instead of reading as
  // a silently-permanent empty state.
  if (!isAdminConfigured()) {
    console.error(
      "[metrics] aggregateTeamLeaderboard: SUPABASE_SERVICE_ROLE_KEY not configured — " +
        "the team leaderboard cannot be computed.",
    );
    return [];
  }
  const admin = createAdminClient();

  const { data: memberRows, error: memberErr } = await admin
    .from("organization_members")
    .select("user_id,name,role")
    .eq("org_id", orgId)
    .eq("status", "active");
  if (memberErr) {
    console.error("[metrics] aggregateTeamLeaderboard members query failed:", memberErr.message);
    return [];
  }
  const members = (memberRows ?? []) as Row[];
  if (!members.length) return [];
  const ids = members.map((m) => String(m.user_id));

  const sinceMonth = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: profRows, error: profErr }, { data: callRows, error: callErr }] =
    await Promise.all([
      admin.from("profiles").select("id,full_name,avatar_color,team").in("id", ids),
      admin
        .from("call_records")
        .select("owner_id,outcome,duration_sec,channel,started_at")
        .eq("org_id", orgId)
        .gte("started_at", sinceMonth)
        // Without an explicit order, a result set past the 50000-row cap comes
        // back in a non-deterministic subset — silently and unpredictably
        // dropping calls (and the dropped set can change between loads) for
        // any org with high enough 30-day volume. Most-recent-first ensures a
        // truncation always drops the OLDEST calls, deterministically.
        .order("started_at", { ascending: false })
        .limit(50000),
    ]);
  if (profErr) console.error("[metrics] aggregateTeamLeaderboard profiles query failed:", profErr.message);
  if (callErr) console.error("[metrics] aggregateTeamLeaderboard call_records query failed:", callErr.message);
  const profById = new Map(((profRows ?? []) as Row[]).map((p) => [String(p.id), p]));
  return composeLeaderboard(members, profById, (callRows ?? []) as Row[], Date.now(), timezone);
}

/** The org-wide leaderboard for the current viewer's organization, + their id. */
export async function getTeamLeaderboard(): Promise<{
  reps: LeaderboardEntry[];
  meId: string | null;
}> {
  if (!isSupabaseConfigured()) return { reps: fallbackLeaderboard(), meId: null };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { reps: fallbackLeaderboard(), meId: null };
    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    if (!orgId) return { reps: [], meId: user.id };
    const { data: org } = await supabase
      .from("organizations")
      .select("timezone")
      .eq("id", orgId)
      .maybeSingle();
    const timezone = (org?.timezone as string) || "UTC";
    return { reps: await aggregateTeamLeaderboard(orgId, timezone), meId: user.id };
  } catch (e) {
    console.error("[metrics] getTeamLeaderboard failed:", e instanceof Error ? e.message : e);
    return { reps: fallbackLeaderboard(), meId: null };
  }
}

function scaleStat(base: LeaderboardStat, factor: number): LeaderboardStat {
  return {
    ...base,
    calls: base.calls * factor,
    connects: base.connects * factor,
    appointments: base.appointments * factor,
    callbacks: base.callbacks * factor,
    talkTimeMin: base.talkTimeMin * factor,
    aiCalls: base.aiCalls * factor,
    humanCalls: base.humanCalls * factor,
  };
}

/** Demo team leaderboard (no Supabase) — derived from the bundled sample reps. */
function fallbackLeaderboard(): LeaderboardEntry[] {
  return sampleLeaderboard.map((r) => {
    const daily: LeaderboardStat = {
      calls: r.callsToday,
      connects: r.conversationsToday,
      appointments: r.appointmentsToday,
      callbacks: Math.round(r.appointmentsToday / 2),
      talkTimeMin: r.talkTimeMin,
      connectRate: r.connectRate,
      conversionRate: pct(r.appointmentsToday, r.conversationsToday),
      aiCalls: Math.round(r.callsToday / 2),
      humanCalls: r.callsToday - Math.round(r.callsToday / 2),
      score: r.score,
    };
    return {
      id: r.id,
      name: r.name,
      initials: r.initials,
      avatarColor: r.avatarColor,
      role: r.role,
      team: r.team,
      daily,
      weekly: scaleStat(daily, 5),
      monthly: scaleStat(daily, 21),
    };
  });
}
