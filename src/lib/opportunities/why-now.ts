import { NEXT_ACTION_LABELS } from "./next-action";
import { relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The "why this person now" sentence (P2.3) — PURE, shared by the dialer card
// and unit tests. Most urgent truth wins: an overdue task beats a hot signal
// beats an overdue next action beats the stage story.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkItemBrief {
  id: string;
  type: string;
  reason: string;
  dueAt: string | null;
  priority: number;
  status: string;
}

export interface SignalBrief {
  id: string;
  type: string;
  severity: number;
  reason: string;
  detectedAt: string;
}

export interface PlaybookBrief {
  id: string;
  name: string;
  status: string;
  step: number;
  startedAt: string;
}

export interface OpportunityContext {
  opportunityId: string;
  stage: string;
  opStatus: string;
  priority: number;
  priorityReason: string | null;
  hotUntil: string | null;
  attemptCount: number;
  contactCount: number;
  firstReceivedAt: string | null;
  lastTouchedAt: string | null;
  stageEnteredAt: string | null;
  nextActionKind: string | null;
  nextActionDueAt: string | null;
  source: string | null;
  workItems: WorkItemBrief[];
  signals: SignalBrief[];
  playbooks: PlaybookBrief[];
}

/** Neutral stage labels — vocabulary-safe (no industry nouns). */
export const STAGE_LABELS: Record<string, string> = {
  new: "New",
  assigned: "Assigned",
  attempting: "Attempting",
  contacted: "Contacted",
  interested: "Interested",
  appointment_booked: "Appointment booked",
  appointment_completed: "Appointment done",
  sold: "Sold",
  nurture: "Nurture",
  lost: "Lost",
  invalid: "Invalid",
  dnc_suppressed: "Do not call",
  exhausted: "Exhausted",
  duplicate: "Duplicate",
  disqualified: "Disqualified",
};

export function nextActionLabel(kind: string): string {
  return (
    NEXT_ACTION_LABELS[kind as keyof typeof NEXT_ACTION_LABELS] ??
    kind.replace(/_/g, " ")
  );
}

/** The one-sentence answer, most urgent truth first. */
export function whyNowLine(
  ctx: Pick<
    OpportunityContext,
    | "workItems"
    | "signals"
    | "nextActionKind"
    | "nextActionDueAt"
    | "attemptCount"
    | "contactCount"
    | "firstReceivedAt"
    | "lastTouchedAt"
    | "stage"
  >,
  leadNoun: string,
  now: Date = new Date(),
): string {
  const due = ctx.workItems.find(
    (w) => !w.dueAt || new Date(w.dueAt).getTime() <= now.getTime(),
  );
  if (due?.reason) return due.reason;
  const hot = ctx.signals.find((s) => s.severity >= 4);
  if (hot) return hot.reason || `Hot signal: ${hot.type.replace(/_/g, " ")}.`;
  if (
    ctx.nextActionKind &&
    ctx.nextActionDueAt &&
    new Date(ctx.nextActionDueAt).getTime() <= now.getTime()
  ) {
    return `${nextActionLabel(ctx.nextActionKind)} was due ${relativeTime(ctx.nextActionDueAt)}.`;
  }
  const upcoming = ctx.workItems[0];
  if (upcoming?.reason) {
    return upcoming.dueAt
      ? `${upcoming.reason} Due ${relativeTime(upcoming.dueAt)}.`
      : upcoming.reason;
  }
  if (ctx.attemptCount === 0) {
    return ctx.firstReceivedAt
      ? `Fresh ${leadNoun} — never called. Came in ${relativeTime(ctx.firstReceivedAt)}.`
      : `Fresh ${leadNoun} — never called.`;
  }
  if (ctx.contactCount === 0) {
    return `Attempt #${ctx.attemptCount + 1} — no conversation yet.`;
  }
  return ctx.lastTouchedAt
    ? `Last touched ${relativeTime(ctx.lastTouchedAt)} · ${STAGE_LABELS[ctx.stage] ?? ctx.stage}.`
    : `${STAGE_LABELS[ctx.stage] ?? ctx.stage}.`;
}
