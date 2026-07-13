// ─────────────────────────────────────────────────────────────────────────────
// Double-booking detection. Pure — the dialog, the drag-drop target and the
// calendar chips all ask the same question and get the same answer.
//
// "Conflict" here means: the SAME PERSON is expected in two places at once. Two
// reps booked at 2pm is a busy Tuesday, not a problem. It is deliberately scoped
// to the assignee, not the org.
//
// Appointments with no pinned time can't conflict with anything — you cannot
// double-book "sometime next week".
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_DURATION_MIN, endOf, startOf } from "./time";

export interface Busy {
  id: string;
  /** Who is expected to be there. Conflicts are per-person, never org-wide. */
  assignee: string | null;
  start: number;
  end: number;
  label: string;
}

export interface ConflictCandidate {
  id: string;
  assignedTo?: string | null;
  ownerId?: string | null;
  scheduledAt: string | null;
  durationMin?: number | null;
  status?: string;
  leadName?: string;
}

/** Half-open [start, end): an appointment ending at 3:00 does NOT clash with one starting at 3:00. */
export function overlaps(a: Busy, b: Busy): boolean {
  if (a.id === b.id) return false;
  if (!a.assignee || !b.assignee || a.assignee !== b.assignee) return false;
  return a.start < b.end && b.start < a.end;
}

/** A schedulable appointment → a Busy span, or null when it can't occupy time. */
export function toBusy(a: ConflictCandidate): Busy | null {
  // Cancelled and no-show reviews free the slot back up.
  if (a.status === "cancelled" || a.status === "no_show") return null;
  const start = startOf(a);
  const end = endOf(a);
  if (!start || !end) return null;
  return {
    id: a.id,
    assignee: a.assignedTo || a.ownerId || null,
    start: start.getTime(),
    end: end.getTime(),
    label: a.leadName || "Appointment",
  };
}

/** Every existing appointment the target would collide with. */
export function findConflicts(
  target: ConflictCandidate,
  others: ConflictCandidate[],
): Busy[] {
  const t = toBusy(target);
  if (!t) return [];
  return others
    .map(toBusy)
    .filter((b): b is Busy => b !== null)
    .filter((b) => overlaps(t, b))
    .sort((a, b) => a.start - b.start);
}

/**
 * Would putting `id`'s appointment at `start` for `durationMin` clash? The
 * question the dialog asks on every keystroke and the drag asks on every frame,
 * so it takes the candidate apart rather than requiring a mutated copy.
 */
export function conflictsAt(
  candidate: { id: string; assignee: string | null },
  start: Date,
  durationMin: number,
  others: ConflictCandidate[],
): Busy[] {
  const t: Busy = {
    id: candidate.id,
    assignee: candidate.assignee,
    start: start.getTime(),
    end: start.getTime() + (durationMin || DEFAULT_DURATION_MIN) * 60_000,
    label: "",
  };
  return others
    .map(toBusy)
    .filter((b): b is Busy => b !== null)
    .filter((b) => overlaps(t, b))
    .sort((a, b) => a.start - b.start);
}

/** IDs of every appointment that clashes with at least one other — for the warning dots. */
export function conflictedIds(appts: ConflictCandidate[]): Set<string> {
  const busy = appts.map(toBusy).filter((b): b is Busy => b !== null);
  const out = new Set<string>();
  for (let i = 0; i < busy.length; i++) {
    for (let j = i + 1; j < busy.length; j++) {
      if (overlaps(busy[i], busy[j])) {
        out.add(busy[i].id);
        out.add(busy[j].id);
      }
    }
  }
  return out;
}
