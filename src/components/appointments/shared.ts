import type { ApptBucket } from "@/lib/appointments-organize";
import type { AppointmentRow } from "@/lib/db/pipeline";

// Vocabulary shared by the workspace, the grids, the list and the dialog, so
// "no-show" is spelled and coloured the same everywhere.

export type Density = "comfortable" | "compact";
// "ai" is kept for back-compat with saved prefs; the UI now splits AI bookings
// into "agent1" (Agent 1) and "agent2" (Agent 2).
export type SourceFilter = "all" | "ai" | "rep" | "agent1" | "agent2";
export type SortKey = "smart" | "soonest" | "newest" | "name";
export type ViewKey = "list" | "month" | "week" | "day";

export interface ApptPrefs {
  view?: ViewKey;
  density?: Density;
  source?: SourceFilter;
  sort?: SortKey;
}

/** What the calendar can do for a viewer, resolved server-side from permissions. */
export interface ApptAccess {
  /** appointments.manage — without it the whole calendar is read-only. */
  canManage: boolean;
  /** appointments.team — sees & manages the whole floor, not just their own. */
  canTeam: boolean;
  /** The signed-in user, for "mine vs theirs" and conflict scoping. */
  meId: string | null;
}

export const BUCKET_ORDER: ApptBucket[] = [
  "review",
  "overdue",
  "today",
  "tomorrow",
  "week",
  "later",
  "past",
  "cancelled",
];

export type Tone = "warning" | "danger" | "accent" | "primary" | "neutral" | "success";

export const BUCKET_META: Record<ApptBucket, { label: string; hint: string; tone: Tone }> = {
  review: { label: "Needs review", hint: "AI proposals awaiting your approval", tone: "warning" },
  overdue: { label: "Overdue", hint: "Past their time, not yet closed out", tone: "danger" },
  today: { label: "Today", hint: "Happening today", tone: "accent" },
  tomorrow: { label: "Tomorrow", hint: "Up next", tone: "accent" },
  week: { label: "This week", hint: "Within the next 7 days", tone: "primary" },
  later: { label: "Later", hint: "Further out or unscheduled", tone: "neutral" },
  past: { label: "Past", hint: "Completed or no-show", tone: "success" },
  cancelled: { label: "Cancelled", hint: "Called off", tone: "neutral" },
};

export const STATUS_META: Record<string, { tone: Tone; label: string }> = {
  scheduled: { tone: "accent", label: "Scheduled" },
  completed: { tone: "success", label: "Completed" },
  no_show: { tone: "danger", label: "No-show" },
  rescheduled: { tone: "warning", label: "Rescheduled" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

export const STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No-show" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancelled" },
];

/** An AI proposal nobody has accepted yet — the only thing the review lane holds. */
export function isReview(a: AppointmentRow): boolean {
  return (
    !a.approved &&
    a.status !== "completed" &&
    a.status !== "no_show" &&
    a.status !== "cancelled"
  );
}

/** Struck-through on the calendar: it occupies a day but nobody is going. */
export function isDead(a: AppointmentRow): boolean {
  return a.status === "cancelled" || a.status === "no_show";
}

/**
 * A GLYPH for the chip's state, and the word it stands for.
 *
 * chipTone below returns fill, border and text colour — nothing else. So on the
 * month and week calendars, completed and scheduled differed by hue alone, and
 * so did cancelled and no-show (line-through applies to both dead states, so it
 * separates them from the living ones but not from each other). Anyone who
 * cannot tell those hues apart was reading a grid with no state on it.
 *
 * Returns null for the ordinary scheduled case, which needs no mark.
 */
export function chipGlyph(a: AppointmentRow): { glyph: string; label: string } | null {
  if (a.status === "cancelled") return { glyph: "✕", label: "Cancelled" };
  if (a.status === "no_show") return { glyph: "!", label: "No-show" };
  if (a.status === "completed") return { glyph: "✓", label: "Completed" };
  if (a.status === "rescheduled") return { glyph: "↻", label: "Rescheduled" };
  if (isReview(a)) return { glyph: "?", label: "Awaiting approval" };
  return null;
}

/** Chip colour on the grid. Colour ALONE never carries the state — see chipGlyph. */
export function chipTone(a: AppointmentRow): string {
  if (a.status === "cancelled") return "border-border/60 bg-muted/60 text-muted-foreground";
  if (a.status === "no_show") return "border-danger/30 bg-danger/10 text-danger";
  if (a.status === "completed") return "border-success/30 bg-success/10 text-success";
  if (isReview(a)) return "border-warning/40 bg-warning/15 text-warning";
  return "border-accent/30 bg-accent-soft text-accent";
}
