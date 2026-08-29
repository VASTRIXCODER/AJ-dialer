// ─────────────────────────────────────────────────────────────────────────────
// Orchestration planning — PURE helpers (no I/O), unit-tested apart from the
// engine's imperative shell. Everything here must be deterministic given its
// inputs: retries and replays depend on reproducing identical values.
// ─────────────────────────────────────────────────────────────────────────────

import { zonedDayHour } from "../dialer/schedule";
import type { Step, StopRule } from "./definition";

/**
 * The exactly-once key for one step execution. `scheduledAtIso` is the step's
 * COMPUTED due time (derived from instance state, never `now()`), so a retry
 * regenerates the same key and the playbook_executions UNIQUE absorbs it.
 */
export function idempotencyKeyFor(
  instanceId: string,
  stepId: string,
  scheduledAtIso: string,
): string {
  return `${instanceId}:${stepId}:${scheduledAtIso}`;
}

/**
 * When a `wait` step releases. Delta waits are exact; `untilLocalTime` resolves
 * to the NEXT occurrence of HH:MM in the given timezone (now counts as passed,
 * so "10:00" at 10:00:30 waits until tomorrow). Minute precision; a DST
 * boundary can shift the release by up to an hour — acceptable for follow-up
 * scheduling, called out in the contracts doc.
 */
export function waitUntil(
  step: Extract<Step, { kind: "wait" }>,
  now: Date,
  timezone: string,
): Date {
  const f = step.for as Record<string, unknown>;
  const local = String(f.untilLocalTime ?? "");
  if (/^\d{2}:\d{2}$/.test(local)) {
    const [hh, mm] = local.split(":").map(Number);
    const { hour, minute } = zonedDayHour(now, timezone);
    const nowMod = hour * 60 + minute;
    const target = hh * 60 + mm;
    let delta = target - nowMod;
    if (delta <= 0) delta += 24 * 60;
    return new Date(now.getTime() + delta * 60_000);
  }
  const ms =
    (Number(f.minutes) || 0) * 60_000 +
    (Number(f.hours) || 0) * 3_600_000 +
    (Number(f.days) || 0) * 86_400_000;
  return new Date(now.getTime() + Math.max(60_000, ms));
}

/** The facts a stop-rule check needs — assembled by the engine, judged here. */
export interface StopSnapshot {
  dncOrOptOut: boolean;
  opportunityClosed: boolean;
  managerPause: boolean;
  contacted: boolean;
  attempted: boolean;
  replied: boolean;
  callbackSet: boolean;
  callbackCompleted: boolean;
  appointmentBooked: boolean;
  sold: boolean;
  complaint: boolean;
  openIssue: boolean;
  reassigned: boolean;
  attemptsSinceActivation: number;
}

/**
 * The first stop rule the snapshot trips, or null. Checked before EVERY
 * action; because v0 is linear, this is also the branching mechanism
 * ("escalate only if still untouched" = wait + `attempted` stop rule).
 */
export function firstTrippedStopRule(
  rules: Set<StopRule>,
  snap: StopSnapshot,
  opts?: { maxAttempts?: number; stopOnReassign?: boolean },
): string | null {
  // The two always-enforced rules first, whatever order the set iterates.
  if (snap.dncOrOptOut) return "dnc_or_opt_out";
  if (snap.opportunityClosed) return "opportunity_closed";
  const table: [StopRule, boolean][] = [
    ["manager_pause", snap.managerPause],
    ["contacted", snap.contacted],
    ["attempted", snap.attempted],
    ["replied", snap.replied],
    ["callback_set", snap.callbackSet],
    ["callback_completed", snap.callbackCompleted],
    ["appointment_booked", snap.appointmentBooked],
    ["sold", snap.sold],
    ["complaint", snap.complaint],
    ["open_issue", snap.openIssue],
  ];
  for (const [rule, tripped] of table) {
    if (tripped && rules.has(rule)) return rule;
  }
  if (
    opts?.maxAttempts != null &&
    opts.maxAttempts > 0 &&
    snap.attemptsSinceActivation >= opts.maxAttempts
  ) {
    return "max_attempts";
  }
  if (opts?.stopOnReassign && snap.reassigned) return "reassigned";
  return null;
}
