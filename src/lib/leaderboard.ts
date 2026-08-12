import { CONNECTED_OUTCOMES } from "./call-analytics";
import { zonedDayKey } from "./dialer/schedule";
import type { CallOutcome, LeaderboardEntry, LeaderboardStat } from "./types";
import { initials } from "./utils";

// ─────────────────────────────────────────────────────────────────────────────
// Pure leaderboard composition — turns raw org rows (members, profiles, call
// records) into per-rep, per-window stats. Kept free of DB/server imports so it
// can be unit-tested in isolation; the Supabase fetch lives in db/metrics.ts.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

interface Acc {
  calls: number;
  connects: number;
  appts: number;
  callbacks: number;
  talk: number;
  ai: number;
  human: number;
}
const newAcc = (): Acc => ({
  calls: 0,
  connects: 0,
  appts: 0,
  callbacks: 0,
  talk: 0,
  ai: 0,
  human: 0,
});

function statOf(a: Acc): LeaderboardStat {
  return {
    calls: a.calls,
    connects: a.connects,
    appointments: a.appts,
    callbacks: a.callbacks,
    talkTimeMin: Math.round(a.talk / 60),
    connectRate: pct(a.connects, a.calls),
    conversionRate: pct(a.appts, a.connects),
    aiCalls: a.ai,
    humanCalls: a.human,
    score: clamp(pct(a.connects, a.calls) * 0.4 + pct(a.appts, a.calls) * 4 + a.appts * 2),
  };
}

/**
 * Build the org-wide leaderboard. Every member is included (even with zero
 * activity), each with stats for today / last 7d / last 30d. `calls` is expected
 * to already be scoped to the org and the last 30 days.
 */
export function composeLeaderboard(
  members: Row[],
  profById: Map<string, Row>,
  calls: Row[],
  now: number = Date.now(),
  /** Org's IANA timezone — determines the "daily" bucket boundary. Weekly and
   *  monthly are rolling windows (not calendar-boundary-sensitive the way a
   *  single day is), so they stay in plain epoch math. Defaults to UTC. */
  timezone: string = "UTC",
): LeaderboardEntry[] {
  const weekMs = now - 7 * DAY_MS;
  const monthMs = now - 30 * DAY_MS;
  const todayKey = zonedDayKey(new Date(now), timezone);

  const buckets = new Map<string, { daily: Acc; weekly: Acc; monthly: Acc }>();
  for (const m of members)
    buckets.set(String(m.user_id), { daily: newAcc(), weekly: newAcc(), monthly: newAcc() });

  for (const c of calls) {
    const b = buckets.get(String(c.owner_id));
    if (!b) continue;
    const o = (c.outcome as CallOutcome) ?? null;
    const connected = o != null && CONNECTED_OUTCOMES.has(o);
    const dur = Number(c.duration_sec ?? 0);
    const human = c.channel === "human";
    const t = c.started_at ? new Date(String(c.started_at)).getTime() : 0;
    const apply = (a: Acc) => {
      a.calls++;
      if (connected) a.connects++;
      if (o === "appointment_booked") a.appts++;
      if (o === "callback_scheduled") a.callbacks++;
      a.talk += dur;
      if (human) a.human++;
      else a.ai++;
    };
    if (t < monthMs) continue; // older than the 30-day window — ignore
    apply(b.monthly);
    if (t >= weekMs) apply(b.weekly);
    // "Today" is a calendar-day boundary, so it's evaluated in the org's own
    // timezone — a plain epoch cutoff (fine for the rolling weekly/monthly
    // windows) rolls "today" over at UTC midnight, misclassifying evening
    // calls into the wrong day for any non-UTC org.
    if (c.started_at && zonedDayKey(new Date(String(c.started_at)), timezone) === todayKey) {
      apply(b.daily);
    }
  }

  return members.map((m) => {
    const id = String(m.user_id);
    const prof = profById.get(id);
    const name = String(prof?.full_name || m.name || "Member");
    const b = buckets.get(id) ?? { daily: newAcc(), weekly: newAcc(), monthly: newAcc() };
    return {
      id,
      name,
      initials: initials(name) || "—",
      // Empty when unset — Avatar's seed prop then hash-picks a chart tone.
      avatarColor: String(prof?.avatar_color || ""),
      role: String(m.role || "rep"),
      team: String(prof?.team || ""),
      daily: statOf(b.daily),
      weekly: statOf(b.weekly),
      monthly: statOf(b.monthly),
    };
  });
}
