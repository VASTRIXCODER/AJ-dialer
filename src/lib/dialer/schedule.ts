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

/** The weekday (0–6) and hour (0–23) of `date` as seen in `timezone`. */
export function zonedDayHour(
  date: Date,
  timezone: string,
): { day: number; hour: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/Chicago",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
  } catch {
    // Invalid timezone string — fall back to UTC rather than throwing.
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
  }
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  let hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  if (hour === 24) hour = 0; // some runtimes render midnight as "24"
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { day: DAY_INDEX[wd] ?? 0, hour, minute };
}

/** YYYY-MM-DD for `date` in `timezone` — used as a per-day counter key. */
export function zonedDayKey(date: Date, timezone: string): string {
  try {
    // en-CA renders as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
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
