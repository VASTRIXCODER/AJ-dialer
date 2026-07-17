import type { AutomationSettings } from "../org/settings";

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

function dayHourFmt(timezone: string): Intl.DateTimeFormat {
  const tz = timezone || "America/Chicago";
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
  const tz = timezone || "America/Chicago";
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

/** Is `now` inside an enabled day + hour window for this automation config? */
export function isAutoDialActive(
  now: Date,
  a: AutomationSettings | null | undefined,
): boolean {
  if (!a?.enabled) return false;
  if (!Array.isArray(a.windows) || a.windows.length === 0) return false;
  const { day, hour } = zonedDayHour(now, a.timezone);
  if (Array.isArray(a.days) && a.days.length && !a.days.includes(day)) return false;
  return a.windows.some(
    (w) => Number.isFinite(w.start) && Number.isFinite(w.end) && hour >= w.start && hour < w.end,
  );
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
