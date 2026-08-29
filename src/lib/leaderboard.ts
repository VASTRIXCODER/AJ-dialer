import { zonedDayKey, zonedDayStartMs } from "./dialer/schedule";
import {
  dayKeyLabel,
  monthKeyLabel,
  weekRange,
  zonedMonthRange,
} from "./metrics/compute";
import { isConnectedRecord } from "./metrics/definitions";
import type { LeaderboardPoints, LeaderboardSettings } from "./org/settings";
import { initials } from "./utils";

// ─────────────────────────────────────────────────────────────────────────────
// Pure leaderboard composition v2 — turns raw org rows (call records,
// appointments, callbacks, members) into a ranked, explainable board.
//
// What changed from v1 and why:
//   • The score formula was hardcoded; now every point comes from the org's own
//     configurable rates (settings.leaderboard) and each entry carries a
//     breakdown that SUMS EXACTLY to its total — no more unexplainable "Score 87".
//   • "This week/month" were rolling 7/30-day windows wearing calendar labels —
//     a lie near month ends. Periods are now CALENDAR-TRUE in the org timezone:
//     daily = the org-tz day, weekly = the calendar week from the configured
//     week start, monthly = the calendar month. Every period label is the exact
//     date range.
//   • Everything derives from ROWS (call_records / appointments / callbacks),
//     never from events, so a duplicated event can't double-score anyone.
//
// Kept free of DB/server imports so it unit-tests in isolation; the Supabase
// fetch lives in db/metrics.ts (aggregateTeamLeaderboard).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
/** Round to 2 decimals — the resolution point totals are stored/displayed at. */
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Scoring components ───────────────────────────────────────────────────────

export type ScoreComponent =
  | "humanConnect"
  | "qualified"
  | "appointmentBooked"
  | "appointmentKept"
  | "callbackCompleted"
  | "talkMinute";

/** Fixed display order for breakdowns — most valuable narrative first. */
export const SCORE_COMPONENTS: ScoreComponent[] = [
  "appointmentKept",
  "appointmentBooked",
  "qualified",
  "callbackCompleted",
  "humanConnect",
  "talkMinute",
];

export const SCORE_COMPONENT_LABELS: Record<ScoreComponent, string> = {
  humanConnect: "Human connects",
  qualified: "Qualified",
  appointmentBooked: "Appointments booked",
  appointmentKept: "Appointments kept",
  callbackCompleted: "Callbacks completed",
  talkMinute: "Talk minutes",
};

export interface BreakdownItem {
  component: ScoreComponent;
  label: string;
  count: number;
  points: number;
}

/** Per-component tallies for one member in one window. */
interface Tally {
  humanConnect: number;
  qualified: number;
  appointmentBooked: number;
  appointmentKept: number;
  callbackCompleted: number;
  /** Connected talk seconds (talkMinute count = whole minutes of this). */
  talkSec: number;
}

const newTally = (): Tally => ({
  humanConnect: 0,
  qualified: 0,
  appointmentBooked: 0,
  appointmentKept: 0,
  callbackCompleted: 0,
  talkSec: 0,
});

const componentCount = (t: Tally, c: ScoreComponent): number =>
  c === "talkMinute" ? Math.floor(t.talkSec / 60) : t[c];

/**
 * Tally → breakdown + total. Zero-count components are omitted from the
 * breakdown; the invariant `total === r2(Σ item.points)` holds by construction
 * (each item's points are rounded to 2dp before summing, so what the tooltip
 * lists is exactly what the total is).
 */
export function buildBreakdown(
  tally: Tally,
  points: LeaderboardPoints,
): { breakdown: BreakdownItem[]; total: number } {
  const breakdown: BreakdownItem[] = [];
  let total = 0;
  for (const component of SCORE_COMPONENTS) {
    const count = componentCount(tally, component);
    if (count <= 0) continue;
    const p = r2(count * points[component]);
    breakdown.push({
      component,
      label: SCORE_COMPONENT_LABELS[component],
      count,
      points: p,
    });
    total = r2(total + p);
  }
  return { breakdown, total };
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/** One member as the composition wants it (db side merges member + profile). */
export interface LeaderboardMember {
  userId: string;
  name: string;
  role: string;
  avatarColor?: string;
  team?: string;
}

export interface LeaderboardPeriodStat {
  calls: number;
  connects: number;
  appointments: number;
  appointmentsKept: number;
  callbacksCompleted: number;
  qualified: number;
  /** Connected talk seconds in the window. */
  talkSec: number;
  talkTimeMin: number;
  /** connects / calls, % */
  connectRate: number;
  /** appointments / connects, % */
  conversionRate: number;
  aiCalls: number;
  humanCalls: number;
  points: number;
  breakdown: BreakdownItem[];
  /** ms of the earliest counted call in the window (tie-breaker); null = none. */
  firstActivityMs: number | null;
}

export interface LeaderboardPeriodMeta {
  key: "daily" | "weekly" | "monthly" | "custom";
  /** Exact date range, e.g. "Mon Aug 24 – Sun Aug 30" or "August 2026". */
  label: string;
  fromKey: string;
  toKey: string;
}

export interface ComposedEntry {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  role: string;
  team: string;
  rank: number;
  stat: LeaderboardPeriodStat;
  /** Consecutive org-tz days (ending today/yesterday) with ≥1 scoring connect. */
  streakDays: number;
  /** Best single org-tz day by points in the supplied rows (≈90-day window). */
  personalBestPoints: number;
  personalBestDay: string | null;
}

export interface ComposedBoard {
  period: LeaderboardPeriodMeta;
  /** Every member, already deterministically ranked (see compareRanked). */
  entries: ComposedEntry[];
}

export interface ComposeOptions {
  period: "daily" | "weekly" | "monthly" | { fromKey: string; toKey: string };
  /** Org IANA timezone — every day boundary is evaluated here. */
  tz: string;
  now?: number;
  /** appointments rows: owner_id, status, created_at (kept = status completed). */
  appointments?: Row[];
  /** callbacks rows: owner_id, assigned_to, status, last_attempt_at. */
  callbacks?: Row[];
}

/** Footer copy for the deterministic tie-break — one string, one truth. */
export const TIE_BREAK_NOTE =
  "Ties break deterministically: points, then connects, then talk time, then earliest activity, then member id.";

/**
 * The one ordering. Two members can never swap places between two renders of
 * the same data: every comparison ends at the stable userId.
 */
export function compareRanked(
  a: { id: string; stat: LeaderboardPeriodStat },
  b: { id: string; stat: LeaderboardPeriodStat },
): number {
  return (
    b.stat.points - a.stat.points ||
    b.stat.connects - a.stat.connects ||
    b.stat.talkSec - a.stat.talkSec ||
    (a.stat.firstActivityMs ?? Infinity) - (b.stat.firstActivityMs ?? Infinity) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// ── Window resolution ────────────────────────────────────────────────────────

/** Resolve a period key into its org-tz calendar window + honest label. */
function resolvePeriod(
  period: ComposeOptions["period"],
  tz: string,
  now: number,
): LeaderboardPeriodMeta {
  if (typeof period === "object") {
    return {
      key: "custom",
      label: `${dayKeyLabel(period.fromKey)} – ${dayKeyLabel(period.toKey)}`,
      fromKey: period.fromKey,
      toKey: period.toKey,
    };
  }
  const nowDate = new Date(now);
  if (period === "daily") {
    const key = zonedDayKey(nowDate, tz);
    return { key: "daily", label: dayKeyLabel(key, { weekday: true }), fromKey: key, toKey: key };
  }
  if (period === "weekly") {
    // weekStart is baked in by the caller via composeLeaderboard (config).
    throw new Error("resolvePeriod: weekly needs weekStart — use composeLeaderboard");
  }
  const { fromKey, toKey } = zonedMonthRange(nowDate, tz);
  return { key: "monthly", label: monthKeyLabel(fromKey), fromKey, toKey };
}

function resolveWindow(
  period: ComposeOptions["period"],
  config: LeaderboardSettings,
  tz: string,
  now: number,
): LeaderboardPeriodMeta {
  if (period === "weekly") {
    const { fromKey, toKey } = weekRange(new Date(now), tz, config.weekStart);
    return {
      key: "weekly",
      label: `${dayKeyLabel(fromKey, { weekday: true })} – ${dayKeyLabel(toKey, { weekday: true })}`,
      fromKey,
      toKey,
    };
  }
  return resolvePeriod(period, tz, now);
}

// ── Composition ──────────────────────────────────────────────────────────────

interface MemberAcc {
  window: Tally;
  calls: number;
  aiCalls: number;
  humanCalls: number;
  firstActivityMs: number | null;
  /** Per-day tallies across ALL supplied rows — streaks + personal best. */
  byDay: Map<string, Tally>;
  /** Day keys with ≥1 scoring connect (streak input). */
  connectDays: Set<string>;
}

/**
 * Build the board for ONE calendar window.
 *
 * Row rules (each spelled out because each one changed a number someone reads):
 *   • AI calls (channel === "ai") are invisible to the board unless
 *     `exclusions.includeAiCalls` — not in points, not in the call counts. A
 *     board that scores only human dials must not display AI volume either.
 *   • A "connect" is the canonical predicate (metrics/definitions.ts) AND, when
 *     the row's talk time is KNOWN, talk ≥ minTalkSecForConnect. Unknown talk
 *     (legacy rows) is not gated — absence of measurement is not evidence of a
 *     2-second call.
 *   • Talk seconds accumulate only on calls that pass the connect gate, so
 *     ringing/voicemail seconds can never buy points.
 *   • appointmentKept comes from appointments ROWS with status "completed"
 *     (the statuses live in src/lib/types.ts: scheduled/completed/no_show/…).
 *   • callbackCompleted comes from callbacks ROWS with status "completed",
 *     stamped at completion time (last_attempt_at), credited to the assigned
 *     rep (falling back to the row's owner).
 */
export function composeLeaderboard(
  rows: Row[],
  members: LeaderboardMember[],
  config: LeaderboardSettings,
  opts: ComposeOptions,
): ComposedBoard {
  const now = opts.now ?? Date.now();
  const tz = opts.tz;
  const period = resolveWindow(opts.period, config, tz, now);
  const { fromKey, toKey } = period;
  const { includeAiCalls, minTalkSecForConnect } = config.exclusions;

  const acc = new Map<string, MemberAcc>();
  for (const m of members) {
    acc.set(m.userId, {
      window: newTally(),
      calls: 0,
      aiCalls: 0,
      humanCalls: 0,
      firstActivityMs: null,
      byDay: new Map(),
      connectDays: new Set(),
    });
  }
  const dayTally = (a: MemberAcc, key: string): Tally => {
    let t = a.byDay.get(key);
    if (!t) {
      t = newTally();
      a.byDay.set(key, t);
    }
    return t;
  };

  // ── One pass over call rows ────────────────────────────────────────────────
  for (const r of rows) {
    const a = acc.get(String(r.owner_id));
    if (!a || !r.started_at) continue;
    const isAi = r.channel === "ai";
    if (isAi && !includeAiCalls) continue; // invisible by config — see banner
    const at = new Date(String(r.started_at));
    const ms = at.getTime();
    if (Number.isNaN(ms)) continue;
    const dayKey = zonedDayKey(at, tz);
    const outcome = r.outcome == null ? null : String(r.outcome);

    // Connect gate: canonical predicate + the minimum-talk threshold.
    const talkRaw = r.talk_sec ?? r.duration_sec;
    const talkKnown = talkRaw != null && Number.isFinite(Number(talkRaw));
    const talk = talkKnown ? Number(talkRaw) : 0;
    const connected =
      isConnectedRecord({
        humanConnected: r.human_connected as boolean | null | undefined,
        outcome,
      }) &&
      (!talkKnown || talk >= minTalkSecForConnect);

    const apply = (t: Tally) => {
      if (connected) {
        t.humanConnect++;
        if (talkKnown) t.talkSec += talk;
      }
      if (outcome === "qualified") t.qualified++;
      if (outcome === "appointment_booked") t.appointmentBooked++;
    };

    // 90-day-ish per-day record (streak + personal best) for every scored row.
    apply(dayTally(a, dayKey));
    if (connected) a.connectDays.add(dayKey);

    // The window itself.
    if (dayKey >= fromKey && dayKey <= toKey) {
      apply(a.window);
      a.calls++;
      if (isAi) a.aiCalls++;
      else a.humanCalls++;
      if (a.firstActivityMs === null || ms < a.firstActivityMs) a.firstActivityMs = ms;
    }
  }

  // ── Appointments kept (rows, not events — a re-save can't double-score) ────
  for (const r of opts.appointments ?? []) {
    if (String(r.status ?? "") !== "completed" || !r.created_at) continue;
    const a = acc.get(String(r.owner_id));
    if (!a) continue;
    const dayKey = zonedDayKey(new Date(String(r.created_at)), tz);
    dayTally(a, dayKey).appointmentKept++;
    if (dayKey >= fromKey && dayKey <= toKey) a.window.appointmentKept++;
  }

  // ── Callbacks completed — credited to the assigned rep, stamped at completion
  for (const r of opts.callbacks ?? []) {
    if (String(r.status ?? "") !== "completed") continue;
    const at = r.last_attempt_at ?? r.created_at;
    if (!at) continue;
    const a = acc.get(String(r.assigned_to ?? "")) ?? acc.get(String(r.owner_id));
    if (!a) continue;
    const dayKey = zonedDayKey(new Date(String(at)), tz);
    dayTally(a, dayKey).callbackCompleted++;
    if (dayKey >= fromKey && dayKey <= toKey) a.window.callbackCompleted++;
  }

  // ── Streaks + personal best (90-day window, org-tz days) ───────────────────
  // Days are walked backward from a LOCAL-NOON anchor (same trick as weekRange):
  // ±24h from ~noon can never skip or repeat a date across a DST transition.
  const todayNoonMs = zonedDayStartMs(now, tz) + DAY_MS / 2;
  const streakOf = (a: MemberAcc): number => {
    let streak = 0;
    for (let i = 0; i < 90; i++) {
      const key = zonedDayKey(new Date(todayNoonMs - i * DAY_MS), tz);
      if (a.connectDays.has(key)) streak++;
      // Today without a connect yet doesn't break a streak — the day isn't over.
      else if (i > 0) break;
    }
    return streak;
  };

  const entries: ComposedEntry[] = members.map((m) => {
    const a = acc.get(m.userId)!;
    const { breakdown, total } = buildBreakdown(a.window, config.points);

    let personalBestPoints = 0;
    let personalBestDay: string | null = null;
    for (const [dayKey, t] of a.byDay) {
      const dayPoints = buildBreakdown(t, config.points).total;
      if (
        dayPoints > personalBestPoints ||
        (dayPoints === personalBestPoints && personalBestDay !== null && dayKey < personalBestDay)
      ) {
        personalBestPoints = dayPoints;
        personalBestDay = dayKey;
      }
    }

    const t = a.window;
    const stat: LeaderboardPeriodStat = {
      calls: a.calls,
      connects: t.humanConnect,
      appointments: t.appointmentBooked,
      appointmentsKept: t.appointmentKept,
      callbacksCompleted: t.callbackCompleted,
      qualified: t.qualified,
      talkSec: t.talkSec,
      talkTimeMin: Math.round(t.talkSec / 60),
      connectRate: pct(t.humanConnect, a.calls),
      conversionRate: pct(t.appointmentBooked, t.humanConnect),
      aiCalls: a.aiCalls,
      humanCalls: a.humanCalls,
      points: total,
      breakdown,
      firstActivityMs: a.firstActivityMs,
    };
    return {
      id: m.userId,
      name: m.name || "Member",
      initials: initials(m.name || "Member") || "—",
      avatarColor: m.avatarColor ?? "",
      role: m.role || "rep",
      team: m.team ?? "",
      rank: 0, // assigned below
      stat,
      streakDays: streakOf(a),
      personalBestPoints,
      personalBestDay,
    };
  });

  entries.sort(compareRanked);
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  return { period, entries };
}
