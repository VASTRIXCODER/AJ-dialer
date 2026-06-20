import "server-only";

import { userDisplay } from "../auth";
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
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { CallOutcome, KpiPoint, MetricSummary, Rep } from "../types";
import { initials } from "../utils";
import { getAIConversationsForMonitor } from "./records";

// ─────────────────────────────────────────────────────────────────────────────
// DB-computed reporting. Every dashboard / report / leaderboard number is
// derived here from the account's own Supabase rows (call_records, appointments,
// leads, ai_conversations). When Supabase isn't configured or there's no
// session, it falls back to the bundled data module so demo mode still works.
// ─────────────────────────────────────────────────────────────────────────────

export type LiveCallState = "initiated" | "in_progress" | "completed" | "failed";

export interface RecentCall {
  id: string;
  leadName: string;
  channel: "ai" | "human";
  repName?: string;
  outcome: CallOutcome | null;
  durationSec: number;
  startedAt: string;
  recordingUrl?: string | null;
  conversationId?: string | null;
  hasSummary: boolean;
  hasRecording: boolean;
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
  hourlyCalls: { hour: string; calls: number; connects: number }[];
  outcomeBreakdown: { name: string; value: number; color: string }[];
  recentCalls: RecentCall[];
  liveCalls: LiveCall[];
  appointments: ApptLite[];
  leaderboard: Rep[];
}

// Outcomes that mean a real conversation took place.
const CONNECTED = new Set<CallOutcome>([
  "appointment_booked",
  "callback_scheduled",
  "qualified",
  "not_interested",
  "do_not_call",
]);

const OUTCOME_META: Record<CallOutcome, { label: string; color: string }> = {
  appointment_booked: { label: "Appointment", color: "var(--color-chart-3)" },
  callback_scheduled: { label: "Callback", color: "var(--color-chart-1)" },
  qualified: { label: "Qualified", color: "var(--color-chart-2)" },
  not_interested: { label: "Not interested", color: "var(--color-chart-5)" },
  no_answer: { label: "No answer", color: "var(--color-chart-4)" },
  voicemail: { label: "Voicemail", color: "var(--color-chart-4)" },
  wrong_number: { label: "Wrong number", color: "var(--color-chart-5)" },
  do_not_call: { label: "Do not call", color: "var(--color-chart-5)" },
};

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

export async function getReportingData(): Promise<ReportingData> {
  if (!isSupabaseConfigured()) return fallbackReporting();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fallbackReporting();

    const [callsRes, apptsRes, leadsRes, profileRes, monitor] = await Promise.all([
      supabase
        .from("call_records")
        .select(
          "id,outcome,duration_sec,channel,started_at,lead_name,conversation_id,recording_url,summary",
        )
        .eq("owner_id", user.id)
        .order("started_at", { ascending: false })
        .limit(2000),
      supabase
        .from("appointments")
        .select("id,status,source,lead_name,scheduled_label,scheduled_at,created_at")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("leads")
        .select("utility_bill,solar_payment,has_ev,has_pool,has_battery")
        .eq("owner_id", user.id)
        .limit(5000),
      supabase
        .from("profiles")
        .select("full_name,avatar_color")
        .eq("id", user.id)
        .maybeSingle(),
      getAIConversationsForMonitor(),
    ]);

    const calls = (callsRes.data ?? []) as Row[];
    const appts = (apptsRes.data ?? []) as Row[];
    const leads = (leadsRes.data ?? []) as Row[];

    const outcomeOf = (r: Row) => (r.outcome as CallOutcome) ?? null;
    const isConnected = (r: Row) => {
      const o = outcomeOf(r);
      return o != null && CONNECTED.has(o);
    };

    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const onDay = (r: Row, field = "started_at") =>
      r[field] ? new Date(String(r[field])) >= startToday : false;

    // ── Counts ────────────────────────────────────────────────────────────────
    const totalCalls = calls.length;
    const connections = calls.filter(isConnected).length;
    const byOutcome = {} as Record<CallOutcome, number>;
    for (const c of calls) {
      const o = outcomeOf(c);
      if (o) byOutcome[o] = (byOutcome[o] ?? 0) + 1;
    }
    const apptOutcome = byOutcome.appointment_booked ?? 0;
    const callbackOutcome = byOutcome.callback_scheduled ?? 0;
    const noAnswerOutcome = (byOutcome.no_answer ?? 0) + (byOutcome.voicemail ?? 0);

    const todays = calls.filter((c) => onDay(c));
    const durations = calls
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

    // ── 7-day trend ─────────────────────────────────────────────────────────────
    const kpiSeries: KpiPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const dayCalls = calls.filter((c) => {
        if (!c.started_at) return false;
        const t = new Date(String(c.started_at));
        return t >= d && t < next;
      });
      const conv = dayCalls.filter(isConnected).length;
      kpiSeries.push({
        label: d.toLocaleDateString("en-US", { weekday: "short" }),
        calls: dayCalls.length,
        conversations: conv,
        appointments: dayCalls.filter((c) => outcomeOf(c) === "appointment_booked")
          .length,
        connectRate: Math.round(pct(conv, dayCalls.length)),
      });
    }

    // ── Hourly (today, business window) ─────────────────────────────────────────
    const hourlyCalls: { hour: string; calls: number; connects: number }[] = [];
    for (let h = 8; h <= 18; h++) {
      const inHour = todays.filter(
        (c) => new Date(String(c.started_at)).getHours() === h,
      );
      hourlyCalls.push({
        hour: fmtHour(h),
        calls: inHour.length,
        connects: inHour.filter(isConnected).length,
      });
    }

    // ── Outcome mix ─────────────────────────────────────────────────────────────
    const outcomeBreakdown = (Object.keys(byOutcome) as CallOutcome[])
      .map((o) => ({
        name: OUTCOME_META[o].label,
        value: Math.round(pct(byOutcome[o], totalCalls)),
        color: OUTCOME_META[o].color,
      }))
      .filter((o) => o.value > 0)
      .sort((a, b) => b.value - a.value);

    // ── Recent calls ────────────────────────────────────────────────────────────
    const recentCalls: RecentCall[] = calls.slice(0, 12).map((r, i) => {
      const outcome = outcomeOf(r);
      const channel = r.channel === "human" ? "human" : "ai";
      const recordingUrl = (r.recording_url as string) ?? null;
      const conversationId = (r.conversation_id as string) ?? null;
      // A recording only exists when the call actually connected — no-answer /
      // voicemail / failed calls have none, so don't offer a dead "Play" link.
      const hasRecording =
        channel === "human"
          ? Boolean(recordingUrl)
          : Boolean(conversationId && outcome && CONNECTED.has(outcome));
      return {
        id: String(r.id ?? conversationId ?? i),
        leadName: String(r.lead_name ?? "Homeowner"),
        channel,
        outcome,
        durationSec: Number(r.duration_sec ?? 0),
        startedAt: String(r.started_at ?? new Date().toISOString()),
        recordingUrl,
        conversationId,
        hasSummary: Boolean(r.summary),
        hasRecording,
      };
    });

    // ── Pipeline + live ─────────────────────────────────────────────────────────
    const appointments: ApptLite[] = appts.slice(0, 30).map((a, i) => ({
      id: String(a.id ?? i),
      leadName: String(a.lead_name ?? "Homeowner"),
      whenLabel: apptWhen(a),
      source: String(a.source ?? "ai"),
      status: String(a.status ?? "scheduled"),
    }));

    const liveCalls: LiveCall[] = monitor.active.map((c) => ({
      id: c.conversationId,
      leadName: c.leadName || "Homeowner",
      city: c.city,
      state: c.state,
    }));

    // ── Leaderboard (single-account → you, with real stats) ────────────────────
    const disp = userDisplay(user);
    const profile = profileRes.data as Row | null;
    const name = (profile?.full_name as string) || disp.name;
    const apptsToday = appts.filter((a) => onDay(a, "created_at")).length;
    const convToday = todays.filter(isConnected).length;
    const you: Rep = {
      id: user.id,
      name,
      email: user.email ?? "",
      avatarColor: (profile?.avatar_color as string) || "#3B82F6",
      initials: initials(name) || disp.initials,
      role: "manager",
      status: "available",
      team: "AIATWORK",
      callsToday: todays.length,
      conversationsToday: convToday,
      appointmentsToday: apptsToday,
      talkTimeMin: Math.round(
        todays.reduce((a, c) => a + Number(c.duration_sec ?? 0), 0) / 60,
      ),
      connectRate: Math.round(metrics.connectRate),
      score: clamp(metrics.connectRate * 0.5 + metrics.appointmentRate * 4 + apptsToday * 2),
    };
    const leaderboard = totalCalls > 0 || apptsToday > 0 ? [you] : [];

    return {
      metrics,
      kpiSeries,
      hourlyCalls,
      outcomeBreakdown,
      recentCalls,
      liveCalls,
      appointments,
      leaderboard,
    };
  } catch {
    return fallbackReporting();
  }
}

// ── Demo / empty fallback (bundled data module) ──────────────────────────────
function fallbackReporting(): ReportingData {
  return {
    metrics: sampleMetrics,
    kpiSeries: sampleKpi,
    hourlyCalls: sampleHourly,
    outcomeBreakdown: sampleOutcomes,
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
      state: c.state === "connected" ? "in_progress" : "initiated",
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
    leaderboard: sampleLeaderboard,
  };
}
