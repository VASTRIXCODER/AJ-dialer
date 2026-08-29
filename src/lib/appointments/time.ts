// ─────────────────────────────────────────────────────────────────────────────
// The single source of truth for appointment time. Pure — no React, no DB — so
// the calendar, the dialer's booking dialog, the email templates and the verify
// script all agree on what "6pm" means.
//
// ── THE INVARIANT ────────────────────────────────────────────────────────────
// `appointments.scheduled_at` is declared `timestamptz`, but it does NOT hold a
// true instant. It holds a FLOATING WALL-CLOCK time.
//
// The app writes an offset-less string — "2026-06-23T18:00:00" — Postgres reads
// that as UTC, and the read path (`toFloatingLocal`) strips the "+00" back off
// on the way out. So "6pm" round-trips as "6pm" regardless of where the server,
// the database, or the browser happens to be. The appointment's actual timezone
// is recorded separately, in `appointments.timezone`.
//
// This is deliberate. An account review at 6pm is at 6pm on the homeowner's
// clock; it does not shift because a rep opened the calendar from another state.
// Do NOT "fix" this into real UTC without backfilling every existing row and
// rewriting every reader — a half-done migration silently moves every
// appointment in the database by hours, and nobody notices until people miss
// their reviews.
//
// Two consequences the whole calendar has to live with:
//   1. `scheduledAt` is NULLABLE and always will be. The AI books "sometime next
//      week" — a human label with no timestamp. Those rows have no place on a
//      grid; they live in the "later" bucket. Every helper here is null-safe.
//   2. Never construct these Dates from `new Date(isoWithOffset)`. Parse through
//      `parseFloating`, which interprets the string in the LOCAL zone so the
//      wall-clock digits survive.
// ─────────────────────────────────────────────────────────────────────────────

export const SLOT_MIN = 15;
export const DEFAULT_DURATION_MIN = 60;
/** Grid rows are hours; the week/day view renders this window. */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 21;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Parse a stored `scheduled_at` into a Date whose LOCAL fields are the intended
 * wall clock. Tolerates a trailing offset (legacy rows, or a value that made a
 * round trip through a driver that added one) by stripping it first.
 */
export function parseFloating(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value));
  if (!m) {
    const fallback = new Date(String(value));
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
    0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "in 2 hours" / "3 hours ago" for a FLOATING value, judged against a floating
 * "now" in the same zone (see zonedFloatingNow in dialer/schedule.ts).
 *
 * Both sides are wall-clock strings in one zone, so parsing each as if it were
 * UTC cancels the zone out and leaves the true signed difference. Passing a
 * floating value to the plain `relativeTime()` instead reads it in the
 * server's zone, which shifts every promise by the org's UTC offset — the
 * reason a callback due at 5pm rendered as "1 hour ago" at midday.
 */
export function floatingRelativeTime(
  value: string | null | undefined,
  floatingNow: string,
): string {
  const asUtc = (v: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
    if (!m) return Number.NaN;
    return Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] ?? 0),
    );
  };
  const then = value ? asUtc(String(value)) : Number.NaN;
  const now = asUtc(floatingNow);
  if (Number.isNaN(then) || Number.isNaN(now)) return "";
  const diffMs = then - now;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (mins < 1) return "now";
  const sign = diffMs < 0 ? -1 : 1;
  if (mins < 60) return rtf.format(sign * mins, "minute");
  if (hours < 24) return rtf.format(sign * hours, "hour");
  return rtf.format(sign * days, "day");
}

/** Wall-clock parts of a floating string as if they were UTC. NaN when unparseable. */
function floatingAsUtcMs(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return Number.NaN;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  );
}

/**
 * FLOATING wall clock in `timezone` → the real UTC instant it names.
 *
 * The inverse of the storage convention, needed wherever a promised time has
 * to live in a genuinely-UTC column (opportunities.next_action_due_at, which
 * Postgres compares against now() inside app_pipeline_leaks). Storing the
 * floating digits there instead makes a 5pm promise look overdue from midday.
 *
 * Two passes so DST boundaries land correctly: the offset is sampled at the
 * naive guess, then re-sampled at the corrected instant, which is the standard
 * fix for the hour where the offset itself changes.
 */
export function floatingToUtcIso(
  value: string | null | undefined,
  timezone: string,
): string | null {
  if (!value) return null;
  const wallMs = floatingAsUtcMs(String(value));
  if (Number.isNaN(wallMs)) return null;
  const fmt = (ms: number): number => {
    // What wall clock does this instant show in `timezone`?
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ms));
    return floatingAsUtcMs(parts.replace(" ", "T"));
  };
  try {
    const offset1 = fmt(wallMs) - wallMs;
    let ts = wallMs - offset1;
    const offset2 = fmt(ts) - ts;
    if (offset2 !== offset1) ts = wallMs - offset2;
    return new Date(ts).toISOString();
  } catch {
    return null;
  }
}

/** Serialize a Date's LOCAL wall clock back to the offset-less storage form. */
export function toFloatingString(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** The exact value an `<input type="datetime-local">` wants (no seconds). */
export function toDateTimeInput(d: Date): string {
  return toFloatingString(d).slice(0, 16);
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

/** Stable "2026-07-14" key for bucketing appointments into day cells. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function isToday(d: Date, now: Date = new Date()): boolean {
  return isSameDay(d, now);
}

/** Sunday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -startOfDay(d).getDay());
}

/** The 7 days of `d`'s week, Sunday first. */
export function weekDays(anchor: Date): Date[] {
  const first = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

export function startOfMonth(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(1);
  return out;
}

/**
 * The 42 cells (6 weeks × 7 days) of a month grid, Sunday-first, including the
 * leading/trailing days that spill in from the neighbouring months. Always 42 so
 * the grid never reflows its height as the user pages through months.
 */
export function monthGrid(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function addMonths(d: Date, n: number): Date {
  const out = startOfDay(d);
  // Clamp to the 1st first, so 31 Jan + 1 month can't skid into March.
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(d.getDate(), lastDay));
  return out;
}

export function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function snapMinutes(minutes: number, snap: number = SLOT_MIN): number {
  return Math.round(minutes / snap) * snap;
}

/**
 * Turn a vertical pixel offset inside a day column into a snapped wall-clock
 * time. `pxPerHour` is the rendered row height; the grid starts at DAY_START_HOUR.
 */
export function slotFromOffset(
  day: Date,
  offsetPx: number,
  pxPerHour: number,
  snap: number = SLOT_MIN,
): Date {
  const rawMinutes = DAY_START_HOUR * 60 + (offsetPx / pxPerHour) * 60;
  const clamped = Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60, rawMinutes));
  const snapped = snapMinutes(clamped, snap);
  const out = startOfDay(day);
  out.setMinutes(snapped);
  return out;
}

/** Where a time sits vertically in the day column, in pixels. */
export function offsetFromSlot(d: Date, pxPerHour: number): number {
  return ((minutesFromMidnight(d) - DAY_START_HOUR * 60) / 60) * pxPerHour;
}

export interface Timed {
  scheduledAt: string | null;
  durationMin?: number | null;
}

/** Start of an appointment as a Date, or null when it has no pinned time. */
export function startOf(a: Timed): Date | null {
  return parseFloating(a.scheduledAt);
}

/** End of an appointment, or null when it has no pinned time. */
export function endOf(a: Timed): Date | null {
  const start = startOf(a);
  if (!start) return null;
  return addMinutes(start, a.durationMin || DEFAULT_DURATION_MIN);
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "2:00 – 3:00 PM" — drops the redundant meridiem on the start when it matches. */
export function formatRange(start: Date, durationMin: number = DEFAULT_DURATION_MIN): string {
  const end = addMinutes(start, durationMin || DEFAULT_DURATION_MIN);
  const a = formatTime(start);
  const b = formatTime(end);
  const meridiem = a.slice(-2);
  return meridiem === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

export function formatDayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * How a timezone reads to a human — "CDT", "PST". Appointments are wall-clock, so
 * the email has to say WHICH clock or "6pm" is meaningless to a reader in another
 * state. Falls back to the raw IANA name if the runtime can't shorten it.
 */
export function timezoneLabel(tz: string | null | undefined, at: Date = new Date()): string {
  if (!tz) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

/**
 * The human sentence for an appointment: the exact time when we have one, the
 * AI's original words when we don't ("Tomorrow afternoon"). Never invents a time.
 */
export function whenLabel(a: Timed & { scheduledLabel?: string; durationMin?: number | null }): string {
  const start = startOf(a);
  if (!start) return a.scheduledLabel?.trim() || "No time set";
  return `${formatDayLabel(start)} · ${formatRange(start, a.durationMin || DEFAULT_DURATION_MIN)}`;
}

/** Whole hours rendered down the left edge of the week/day grid. */
export function gridHours(): number[] {
  return Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);
}
