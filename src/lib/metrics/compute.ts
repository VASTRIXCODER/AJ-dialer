import { zonedDayHour, zonedDayKey, zonedDayStartMs } from "../dialer/schedule";
import { isCancelledAppointment, isConnectedRecord } from "./definitions";

// ─────────────────────────────────────────────────────────────────────────────
// Pure metric computations — the arithmetic behind definitions.ts, operating on
// plain row shapes so it unit-tests without a DB and runs on server or client.
// db-side code fetches rows and feeds them here; nothing else may re-derive
// these numbers (that's how the pre-Phase-1 surfaces drifted apart).
//
// Day-key ranges here are INCLUSIVE [fromKey, toKey]: keys name whole local
// days, so the glossary's half-open timestamp convention [from, to) becomes
// "every day from fromKey through toKey" once quantized to YYYY-MM-DD.
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricRow {
  /** ISO timestamp of when the attempt started dialing. */
  startedAt: string;
  outcome: string | null;
  humanConnected?: boolean | null;
  /** Connected→ended seconds; absent on legacy rows (fall back to durationSec). */
  talkSec?: number | null;
  durationSec: number;
  /** Set when the attempt died in the system (carrier error etc.) before an outcome. */
  failureKind?: string | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A system failure (failure_kind set, no outcome ever recorded) was never a real
 * attempt at a human, so it stays out of the connect-rate denominator — but it
 * still counts in `calls` so ops can see the raw dial volume.
 */
const isSystemFailure = (r: MetricRow) => Boolean(r.failureKind) && r.outcome == null;

export function summarize(rows: MetricRow[]): {
  calls: number;
  eligibleAttempts: number;
  humanConnects: number;
  voicemails: number;
  connectRate: number;
  avgTalkSec: number;
} {
  const eligibleAttempts = rows.filter((r) => !isSystemFailure(r)).length;
  const connected = rows.filter(isConnectedRecord);
  const voicemails = rows.filter((r) => r.outcome === "voicemail").length;
  // Talk time is measured over CONNECTED calls only — ringing and voicemail
  // seconds would drag the average toward zero and hide real conversations.
  const talkTotal = connected.reduce((sum, r) => sum + (r.talkSec ?? r.durationSec), 0);
  return {
    calls: rows.length,
    eligibleAttempts,
    humanConnects: connected.length,
    voicemails,
    connectRate: eligibleAttempts > 0 ? round1((connected.length / eligibleAttempts) * 100) : 0,
    avgTalkSec: connected.length > 0 ? Math.round(talkTotal / connected.length) : 0,
  };
}

/**
 * Every row lands in exactly one bucket — its outcome, or `noOutcome` — so
 * counts + noOutcome always reconciles to total and nothing is silently dropped.
 */
export function outcomeMix(rows: MetricRow[]): {
  counts: Record<string, number>;
  noOutcome: number;
  total: number;
} {
  const counts: Record<string, number> = {};
  let noOutcome = 0;
  for (const r of rows) {
    if (r.outcome == null) noOutcome += 1;
    else counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  }
  return { counts, noOutcome, total: rows.length };
}

/**
 * Attempts/connects grouped by LOCAL call-start hour for one local day. DST-safe
 * because buckets are local-hour labels, not fixed 60-minute slices: the
 * spring-forward day simply has no hour-2 bucket, and the fall-back day folds
 * both 1am passes into the hour-1 bucket — rows are never lost or double-counted.
 */
export function hourlyBuckets(
  rows: MetricRow[],
  dayKey: string,
  tz: string,
): { hour: number; calls: number; connects: number }[] {
  const byHour = new Map<number, { hour: number; calls: number; connects: number }>();
  for (const r of rows) {
    const at = new Date(r.startedAt);
    if (zonedDayKey(at, tz) !== dayKey) continue;
    const { hour } = zonedDayHour(at, tz);
    let bucket = byHour.get(hour);
    if (!bucket) {
      bucket = { hour, calls: 0, connects: 0 };
      byHour.set(hour, bucket);
    }
    bucket.calls += 1;
    if (isConnectedRecord(r)) bucket.connects += 1;
  }
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

const DAY_MS = 86_400_000;

/**
 * The org-tz calendar week containing `now`, starting Sunday (0) or Monday (1).
 * Days are enumerated from a LOCAL-NOON anchor: midnight + 12h always lands
 * inside the same local day, and stepping ±24h from ~noon can never skip or
 * repeat a date across a DST transition (the ±1h drift stays hours away from
 * either midnight). Anchoring at midnight and adding 24h would break on the
 * 23/25-hour days.
 */
export function weekRange(
  now: Date,
  tz: string,
  weekStart: 0 | 1,
): { fromKey: string; toKey: string; days: string[] } {
  const noonMs = zonedDayStartMs(now.getTime(), tz) + DAY_MS / 2;
  const { day } = zonedDayHour(now, tz);
  const back = (day - weekStart + 7) % 7;
  const days = Array.from({ length: 7 }, (_, i) =>
    zonedDayKey(new Date(noonMs + (i - back) * DAY_MS), tz),
  );
  return { fromKey: days[0], toKey: days[6], days };
}

/**
 * The org-tz calendar month containing `now`. Once the local day-key is known,
 * the month is pure calendar arithmetic on YYYY-MM-DD strings — no timestamp
 * stepping at all, so DST can't touch it (the keys already encode the org's
 * local calendar; Date.UTC is used only to count the days in the month).
 */
export function zonedMonthRange(
  now: Date,
  tz: string,
): { fromKey: string; toKey: string; days: string[] } {
  const [y, m] = zonedDayKey(now, tz).split("-").map(Number);
  // Day 0 of the NEXT month = the last day of this month.
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  const days = Array.from(
    { length: daysInMonth },
    (_, i) => `${y}-${mm}-${String(i + 1).padStart(2, "0")}`,
  );
  return { fromKey: days[0], toKey: days[daysInMonth - 1], days };
}

/**
 * Human label for a YYYY-MM-DD day key — "Mon Aug 24" / "Aug 24" / "Aug 24, 2026".
 * A day key is a calendar date, not an instant, so it's rendered at UTC noon of
 * that date: no viewer/server timezone can shift it onto a neighboring day.
 */
export function dayKeyLabel(
  key: string,
  opts: { weekday?: boolean; year?: boolean } = {},
): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(opts.weekday ? { weekday: "short" as const } : {}),
    ...(opts.year ? { year: "numeric" as const } : {}),
  });
}

/** "August 2026" for the month a day key falls in (leaderboard month label). */
export function monthKeyLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/**
 * Distinct non-cancelled appointments CREATED in the [fromKey, toKey] local-day
 * range. Creations only — edits and reschedules never re-increment, and both
 * historical spellings of "cancelled" are excluded.
 */
export function appointmentsSet(
  appts: { createdAt: string; status: string }[],
  fromKey: string,
  toKey: string,
  tz: string,
): number {
  let count = 0;
  for (const a of appts) {
    const status = a.status?.toLowerCase();
    if (isCancelledAppointment(status)) continue;
    const key = zonedDayKey(new Date(a.createdAt), tz);
    if (key >= fromKey && key <= toKey) count += 1;
  }
  return count;
}
