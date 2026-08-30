import type { AutomationSettings } from "../org/settings";
import { DEFAULT_TIMEZONE } from "../metrics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// Pure schedule matching for unattended AI calling — client- & server-safe.
// Evaluates "should the dialer be auto-calling right now?" in the org's own
// timezone, so windows like 8–9am / 11am–3pm / 5–7pm mean local wall-clock time
// regardless of where the server runs.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// `new Intl.DateTimeFormat(...)` is one of the most expensive calls in V8, and
// these helpers run once per row in tight aggregation loops (dashboard trends,
// leaderboard) that can iterate tens of thousands of times. Constructing a fresh
// formatter every call turned a large org's dashboard render into minutes of pure
// CPU. Build each `(timezone, shape)` formatter ONCE and reuse it — output is
// identical, so nothing about behavior changes. An invalid timezone falls back to
// UTC and is cached under its own key so the fallback path is paid at most once.
const dayHourFmts = new Map<string, Intl.DateTimeFormat>();
const dayKeyFmts = new Map<string, Intl.DateTimeFormat>();
const floatingFmts = new Map<string, Intl.DateTimeFormat>();

function floatingFmt(timezone: string): Intl.DateTimeFormat {
  const tz = timezone || DEFAULT_TIMEZONE;
  let f = floatingFmts.get(tz);
  if (!f) {
    // sv-SE renders "YYYY-MM-DD HH:mm:ss" — one space away from the floating
    // wall-clock shape the app stores.
    const opts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    };
    try {
      f = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, ...opts });
    } catch {
      f = new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", ...opts });
    }
    floatingFmts.set(tz, f);
  }
  return f;
}

/**
 * "Now" as a FLOATING wall-clock string in `timezone` — "2026-08-29T15:00:00".
 *
 * This is the only correct right-hand side for a comparison against
 * `callbacks.due_at` or `appointments.scheduled_at`, which store offset-less
 * wall-clock strings (see src/lib/appointments/time.ts and the offset guard in
 * db/callbacks.ts `rescheduleCallback`). Comparing those columns against
 * `new Date().toISOString()` instead shifts every verdict by the zone's UTC
 * offset, which reads a promise due at 5pm as overdue from midday.
 */
export function zonedFloatingNow(at: Date, timezone: string): string {
  return floatingFmt(timezone).format(at).replace(" ", "T");
}

function dayHourFmt(timezone: string): Intl.DateTimeFormat {
  const tz = timezone || DEFAULT_TIMEZONE;
  let f = dayHourFmts.get(tz);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts });
    } catch {
      // Invalid timezone string — fall back to UTC rather than throwing.
      f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts });
    }
    dayHourFmts.set(tz, f);
  }
  return f;
}

function dayKeyFmt(timezone: string): Intl.DateTimeFormat {
  const tz = timezone || DEFAULT_TIMEZONE;
  let f = dayKeyFmts.get(tz);
  if (!f) {
    // en-CA renders as YYYY-MM-DD.
    const opts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opts });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", ...opts });
    }
    dayKeyFmts.set(tz, f);
  }
  return f;
}

/** The weekday (0–6) and hour (0–23) of `date` as seen in `timezone`. */
export function zonedDayHour(
  date: Date,
  timezone: string,
): { day: number; hour: number; minute: number } {
  const parts = dayHourFmt(timezone).formatToParts(date);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  let hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  if (hour === 24) hour = 0; // some runtimes render midnight as "24"
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { day: DAY_INDEX[wd] ?? 0, hour, minute };
}

/**
 * The UTC instant (ms) of midnight that starts the calendar day containing `at`,
 * as seen in `timezone`. Used to build a `.gte("started_at", …)` "since today"
 * bound for count queries. Exact to the millisecond: the hour/minute come from
 * the zone (whole numbers), while seconds/ms are timezone-invariant.
 */
export function zonedDayStartMs(at: number, timezone: string): number {
  const d = new Date(at);
  const { hour, minute } = zonedDayHour(d, timezone);
  const sinceMidnight =
    ((hour * 60 + minute) * 60 + d.getUTCSeconds()) * 1000 + d.getUTCMilliseconds();
  return at - sinceMidnight;
}

/** YYYY-MM-DD for `date` in `timezone` — used as a per-day counter key. */
export function zonedDayKey(date: Date, timezone: string): string {
  return dayKeyFmt(timezone).format(date);
}

/**
 * Is `now` inside an enabled day + hour window, evaluated in `timezone`? Split out
 * from isAutoDialActive so the auto-dialer can check each LEAD's own timezone
 * (TCPA governs the called party's local time) rather than only the org's.
 */
export function isWithinCallingWindow(
  now: Date,
  a: AutomationSettings | null | undefined,
  timezone: string,
): boolean {
  if (!a?.enabled) return false;
  if (!Array.isArray(a.windows) || a.windows.length === 0) return false;
  const { day, hour } = zonedDayHour(now, timezone);
  if (Array.isArray(a.days) && a.days.length && !a.days.includes(day)) return false;
  return a.windows.some(
    (w) => Number.isFinite(w.start) && Number.isFinite(w.end) && hour >= w.start && hour < w.end,
  );
}

/** The shape of `settings.hours` this module needs (kept structural so the
 *  pure client bundle doesn't have to import the whole OrgSettings type). */
export interface OrgHours {
  startHour: number;
  endHour: number;
  days: number[];
}

/**
 * Is `now` inside the org's calling hours, evaluated in `timezone`? Used both
 * ways `settings.hours` can act: advisory (the dialer's outside-hours banner)
 * and enforced (`hours.enforced` — the call routes refuse the dial).
 *
 * Degenerate configs never block: equal start/end hours or non-finite numbers
 * read as "always open", and an empty day list means every day — a half-saved
 * blob must not brick a floor's dialing.
 */
export function isWithinOrgHours(
  now: Date,
  hours: OrgHours | null | undefined,
  timezone: string,
): boolean {
  if (!hours) return true;
  const start = Number(hours.startHour);
  const end = Number(hours.endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return true;
  const { day, hour } = zonedDayHour(now, timezone);
  if (Array.isArray(hours.days) && hours.days.length && !hours.days.includes(day)) {
    return false;
  }
  // Overnight windows wrap: 20 → 6 means 8pm through 5:59am.
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Human-readable org-hours line, e.g. "Mon–Fri, 8am–8pm". */
export function describeOrgHours(hours: OrgHours): string {
  return `${describeDays(hours.days?.length ? hours.days : [0, 1, 2, 3, 4, 5, 6])}, ${fmtHour(hours.startHour)}–${fmtHour(hours.endHour)}`;
}

/** Is `now` inside an enabled day + hour window in the ORG's timezone? */
export function isAutoDialActive(
  now: Date,
  a: AutomationSettings | null | undefined,
): boolean {
  return isWithinCallingWindow(now, a, a?.timezone ?? DEFAULT_TIMEZONE);
}

const fmtHour = (h: number): string => {
  const hh = ((h % 24) + 24) % 24;
  const period = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${period}`;
};

/** Human-readable window list, e.g. "8–9am, 11am–3pm, 5–7pm". */
export function describeWindows(windows: { start: number; end: number }[]): string {
  if (!windows?.length) return "no windows set";
  return windows.map((w) => `${fmtHour(w.start)}–${fmtHour(w.end)}`).join(", ");
}

/** Short day summary, e.g. "every day", "Mon–Fri", or "Mon, Wed, Fri". */
export function describeDays(days: number[]): string {
  if (!days?.length) return "no days";
  const set = [...new Set(days)].sort((x, y) => x - y);
  if (set.length === 7) return "every day";
  if (set.join(",") === "1,2,3,4,5") return "Mon–Fri";
  if (set.join(",") === "0,1,2,3,4,5,6") return "every day";
  return set.map((d) => DAY_LABEL[d]).join(", ");
}
