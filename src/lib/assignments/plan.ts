// ─────────────────────────────────────────────────────────────────────────────
// Assignment planning — PURE module (no server-only, no DB).
//
// The Assignment Center and the rep's My Assignments both derive everything
// they show from two inputs: the pack row (status / due date) and the pack's
// CURRENT leads. These helpers are the single place those derivations live, so
// the manager's table, the rep's lanes, and the API all bucket a lead the same
// way — and so the classification can be unit-tested without a database
// (tests/assignments-plan.test.ts).
//
// Stored keys never move: buckets are computed FROM the canonical LeadStatus
// keys (`bills_fine`, `dnc`, …); only the words a human reads come from the
// workspace vocabulary at render time.
// ─────────────────────────────────────────────────────────────────────────────

export type AssignmentStatus = "active" | "paused" | "completed" | "archived";
export type AssignmentDialingMode = "manual" | "ai" | "either";

export const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  "active",
  "paused",
  "completed",
  "archived",
];

export const ASSIGNMENT_DIALING_MODES: readonly AssignmentDialingMode[] = [
  "manual",
  "ai",
  "either",
];

export function isAssignmentStatus(v: unknown): v is AssignmentStatus {
  return typeof v === "string" && (ASSIGNMENT_STATUSES as readonly string[]).includes(v);
}

export function isAssignmentDialingMode(v: unknown): v is AssignmentDialingMode {
  return (
    typeof v === "string" && (ASSIGNMENT_DIALING_MODES as readonly string[]).includes(v)
  );
}

/** Mutually-exclusive current-state buckets over a pack's leads. */
export interface AssignmentProgress {
  total: number;
  /** status "new" AND never contacted — genuinely untouched work. */
  untouched: number;
  /** Everything mid-flight: contacted / no_answer, or a "new" lead that HAS
   *  been contacted (a retry put it back in play — it isn't untouched). */
  inProgress: number;
  callback: number;
  appointment: number;
  dnc: number;
  /** Terminal verdicts: qualified / not_interested / bills_fine. */
  completed: number;
}

export const EMPTY_PROGRESS: AssignmentProgress = {
  total: 0,
  untouched: 0,
  inProgress: 0,
  callback: 0,
  appointment: 0,
  dnc: 0,
  completed: 0,
};

export type ProgressBucket = Exclude<keyof AssignmentProgress, "total">;

/** Statuses that count as a finished verdict on the lead. `appointment` and
 *  `dnc` are terminal too but get their OWN buckets — a booked meeting and a
 *  suppression are outcomes a manager reads separately from "worked through." */
const COMPLETED_STATUSES: ReadonlySet<string> = new Set([
  "qualified",
  "not_interested",
  "bills_fine",
]);

/**
 * Which bucket ONE lead lands in. Extends how lead-pack-assign.ts computed
 * "worked" (status !== 'new'): untouched additionally requires that the lead
 * was never contacted, so a lead reset to "new" after a call still reads as
 * in-progress rather than pretending the work never happened.
 */
export function classifyLeadBucket(
  status: string,
  lastContactedAt?: string | null,
): ProgressBucket {
  switch (status) {
    case "callback":
      return "callback";
    case "appointment":
      return "appointment";
    case "dnc":
      return "dnc";
    case "new":
      return lastContactedAt ? "inProgress" : "untouched";
    default:
      return COMPLETED_STATUSES.has(status) ? "completed" : "inProgress";
  }
}

/** Fold a pack's leads into the bucket counts — one pass, no allocation churn. */
export function summarizeProgress(
  rows: { status: string; lastContactedAt?: string | null }[],
): AssignmentProgress {
  const p: AssignmentProgress = { ...EMPTY_PROGRESS };
  for (const row of rows) {
    p.total += 1;
    p[classifyLeadBucket(row.status, row.lastContactedAt)] += 1;
  }
  return p;
}

/** Leads a rep can still act on — the "Continue" button's remaining count. */
export function remainingCount(p: AssignmentProgress): number {
  return p.untouched + p.inProgress + p.callback;
}

/** worked = has left the untouched state (lead-pack-assign's definition,
 *  extended: a contacted-then-reset "new" lead counts as worked). */
export function workedCount(p: AssignmentProgress): number {
  return Math.max(0, p.total - p.untouched);
}

export interface DueFlags {
  /** Past its due date while the work is still open (active or paused). */
  overdue: boolean;
  /** Due within the next 48h and still open — worth surfacing before it slips. */
  dueSoon: boolean;
}

const DUE_SOON_MS = 48 * 3_600_000;

/**
 * Due/overdue derivation. A completed or archived pack is never overdue — the
 * flag describes work at risk, not history — and an unparseable/absent due
 * date raises nothing rather than crying wolf forever.
 */
export function deriveDueFlags(
  dueDate: string | null | undefined,
  status: AssignmentStatus,
  now: Date,
): DueFlags {
  if (!dueDate || (status !== "active" && status !== "paused")) {
    return { overdue: false, dueSoon: false };
  }
  const t = Date.parse(dueDate);
  if (Number.isNaN(t)) return { overdue: false, dueSoon: false };
  const delta = t - now.getTime();
  return { overdue: delta < 0, dueSoon: delta >= 0 && delta <= DUE_SOON_MS };
}

/** The rep-side lane an assignment card lands in. Overdue outranks Active —
 *  the whole point of the lane is that it jumps the queue visually. */
export type AssignmentLane = "overdue" | "active" | "paused" | "completed";

export function assignmentLane(
  status: AssignmentStatus,
  overdue: boolean,
): AssignmentLane {
  if (status === "paused") return "paused";
  if (status === "completed" || status === "archived") return "completed";
  return overdue ? "overdue" : "active";
}

// ─────────────────────────────────────────────────────────────────────────────
// Allocation-source resolution — what p_lead_ids the RPC receives.
// ─────────────────────────────────────────────────────────────────────────────

export type AllocationSourceKind = "pool" | "filter" | "smart_list";

/**
 * The p_lead_ids decision, decoupled from any DB call so it can be pinned by
 * a test: the unassigned POOL passes null (the RPC's own eligibility scan is
 * the source of truth); filter/smart-list sources MUST pass the resolved
 * candidate ids — and an empty resolution is a hard stop, because null would
 * silently widen "my filter matched nothing" into "allocate from everything."
 */
export function planAllocationLeadIds(
  kind: AllocationSourceKind,
  resolvedIds: string[] | null | undefined,
): { ok: true; leadIds: string[] | null } | { ok: false; error: string } {
  if (kind === "pool") return { ok: true, leadIds: null };
  const ids = resolvedIds ?? [];
  if (ids.length === 0) {
    return {
      ok: false,
      error:
        kind === "smart_list"
          ? "That smart list has no allocatable leads right now."
          : "That filter doesn't match any leads right now.",
    };
  }
  return { ok: true, leadIds: ids };
}

/** Hard ceiling on candidate ids resolved from a filter/smart list — beyond
 *  this the request body and the RPC's ANY() both get unreasonable. */
export const MAX_ALLOCATION_CANDIDATES = 10_000;
