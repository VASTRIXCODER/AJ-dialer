import type { CallOutcome } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Next action (P2.3): after every filed disposition the opportunity carries an
// explicit answer to "what happens next, and when" — the phase_two.md §3 rule
// that nothing sits in limbo. PURE so the mapping is unit-testable; the sync
// hook applies the result to the row.
//
// Timestamps follow the callbacks convention exactly: the drafts carry a
// FLOATING wall-clock iso ("2026-06-23T18:00:00") that is stored as-is —
// callbacks.due_at already works this way, and the two must sort together.
// ─────────────────────────────────────────────────────────────────────────────

/** The kinds a disposition can stamp. Playbooks may stamp others. */
export type NextActionKind =
  | "callback"
  | "attend_appointment"
  | "follow_up_call"
  | "nurture_check_in";

export interface NextAction {
  kind: NextActionKind;
  /** Floating/UTC iso, or null = "due now / no time agreed" (callbacks rule). */
  dueAt: string | null;
}

/** Human labels for anything that renders a next action. */
export const NEXT_ACTION_LABELS: Record<NextActionKind, string> = {
  callback: "Call back",
  attend_appointment: "Appointment",
  follow_up_call: "Follow-up call",
  nurture_check_in: "Nurture check-in",
};

const DAY_MS = 86_400_000;

function plusDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/**
 * What the opportunity's next action becomes after this outcome.
 *
 * - `NextAction`  → stamp it (only while the opportunity is still open).
 * - `"clear"`     → wipe the next action (closing outcomes, dead numbers).
 * - `null`        → leave whatever is there untouched (unknown/absent outcome).
 */
export function nextActionForOutcome(
  outcome: CallOutcome | null,
  opts: { callbackAt?: string | null; appointmentAt?: string | null; now?: Date } = {},
): NextAction | "clear" | null {
  const now = opts.now ?? new Date();
  switch (outcome) {
    case "callback_scheduled":
      // No agreed time = due now, exactly how the Callbacks board reads it.
      return { kind: "callback", dueAt: opts.callbackAt ?? null };
    case "appointment_booked":
      return { kind: "attend_appointment", dueAt: opts.appointmentAt ?? null };
    case "qualified":
      return { kind: "follow_up_call", dueAt: plusDays(now, 1) };
    case "no_answer":
    case "voicemail":
      return { kind: "follow_up_call", dueAt: plusDays(now, 2) };
    case "bills_fine":
      return { kind: "nurture_check_in", dueAt: plusDays(now, 30) };
    case "wrong_number":
      // Redialing the same wrong number is not a next action. The contact info
      // has to change first, and that's a human/skip-trace event, not a timer.
      return "clear";
    case "not_interested":
    case "do_not_call":
      // The opportunity closes on these; a lingering "follow up" would lie.
      return "clear";
    default:
      return null;
  }
}
