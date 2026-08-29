import type { LeadStatus } from "../types";
import type { AutomationSettings } from "../org/settings";
import { BLOCKED_SEGMENTS } from "./segments";
import { isWithinCallingWindow } from "./schedule";
import { resolveLeadTimezone } from "./lead-timezone";

// ─────────────────────────────────────────────────────────────────────────────
// Pure dial-eligibility — ONE answer to "may this lead be dialed right now?".
//
// -- LOCKSTEP: keep in sync with app_claim_dial_leads in supabase/schema.sql --
// This evaluator mirrors the WHERE clause of the claim RPC (slice B3). The RPC
// is what actually gates the database; this module exists so the app can (a)
// pre-filter candidates without a round trip, (b) EXPLAIN to a human why a
// specific lead was skipped — SQL can only silently omit rows — and (c) unit-
// test the policy. Any predicate added here must be added there, and vice versa.
//
// Design decisions that are policy, not accident:
// - ALL failing reasons are collected, not first-fail. "Why isn't this lead in
//   my queue?" needs the full answer; short-circuiting hides the second reason
//   until the first is fixed.
// - `dnc` (the status) and the DNC number list are NEVER bypassed — not by
//   supervisors, not by due callbacks, not by any policy. Same for the calling
//   window: TCPA governs the called party's local wall-clock, so a due callback
//   at 11pm still waits for morning.
// - Due callbacks bypass ONLY the throttles (cooldown, max attempts,
//   next_eligible_at): the homeowner asked for the call, so our own pacing
//   rules yield — legal rules don't.
// - An EXPIRED reservation does not block: reservations exist to stop two reps
//   double-dialing in the same minute, not to strand leads behind a crashed tab.
// ─────────────────────────────────────────────────────────────────────────────

/** The columns the claim RPC reads — a lead row flattened for the evaluator. */
export interface LeadSnapshot {
  id: string;
  orgId: string | null;
  ownerId: string | null;
  assignedRepId: string | null;
  status: LeadStatus;
  phoneDigits: string;
  timezone: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextEligibleAt: string | null;
  reservedBy: string | null;
  reservedUntil: string | null;
  campaignId: string | null;
  leadPackId: string | null;
}

/** What the session/org allows — the operator-tunable half of the predicate. */
export interface EligibilityPolicy {
  statuses: LeadStatus[];
  cooldownMinutes: number;
  /** 0 = unlimited. */
  maxAttempts: number;
  /** Calling-window schedule, evaluated in each LEAD's own timezone. Null = no window gate. */
  window: AutomationSettings | null;
  campaignId?: string | null;
  packId?: string | null;
}

/** Who is asking, when, and the lookups only the caller can provide. */
export interface EligibilityContext {
  now: Date;
  actor: { userId: string; orgId: string; supervisor: boolean };
  mode: "manual" | "parallel" | "ai";
  policy: EligibilityPolicy;
  /** DNC membership by the LAST TEN digits of the number — the list's key shape. */
  isDnc: (last10: string) => boolean;
  /** Leads with a live call leg right now — a second dial would collide. */
  activeCallLeadIds?: ReadonlySet<string>;
  /** Leads whose scheduled callback is due — unlocks the throttle bypasses. */
  dueCallbackLeadIds?: ReadonlySet<string>;
}

export type IneligibleReason =
  | "wrong_org"
  | "not_assigned"
  | "blocked_status"
  | "status_not_selected"
  | "invalid_phone"
  | "dnc"
  | "outside_window"
  | "reserved_elsewhere"
  | "active_call"
  | "max_attempts"
  | "cooldown"
  | "not_yet_eligible"
  | "wrong_campaign"
  | "wrong_pack";

export interface EligibilityResult {
  eligible: boolean;
  reasons: IneligibleReason[];
}

/** Strip a phone to bare digits — the shape LeadSnapshot.phoneDigits expects. */
export function leadSnapshotDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

// Timestamps arrive as ISO strings straight off Postgres rows. Date.parse of an
// invalid/absent value is NaN, and every NaN comparison is false — which lands
// on the safe side for each rule below (an unparseable reservation doesn't
// block; an unparseable cooldown stamp doesn't throttle a lead forever).
const ms = (iso: string | null): number =>
  iso ? Date.parse(iso) : Number.NaN;

/**
 * Evaluate every rule and return ALL the reasons this lead can't be dialed.
 * `eligible` is simply `reasons.length === 0`.
 */
export function evaluateEligibility(
  lead: LeadSnapshot,
  ctx: EligibilityContext,
): EligibilityResult {
  const { now, actor, policy } = ctx;
  const nowMs = now.getTime();
  const reasons: IneligibleReason[] = [];
  const isDueCallback = ctx.dueCallbackLeadIds?.has(lead.id) ?? false;

  // Tenancy: a lead with no org yet (legacy rows) is claimable; a lead in
  // ANOTHER org never is, supervisor or not.
  if (lead.orgId && lead.orgId !== actor.orgId) reasons.push("wrong_org");

  // Ownership: reps dial their own book; supervisors see the whole org's.
  if (
    !actor.supervisor &&
    lead.ownerId !== actor.userId &&
    lead.assignedRepId !== actor.userId
  ) {
    reasons.push("not_assigned");
  }

  // The two legal gates — nothing anywhere in this file bypasses them.
  if (BLOCKED_SEGMENTS.includes(lead.status)) reasons.push("blocked_status");

  if (!policy.statuses.includes(lead.status)) reasons.push("status_not_selected");

  const digits = leadSnapshotDigits(lead.phoneDigits);
  if (digits.length < 10) reasons.push("invalid_phone");

  // DNC list is keyed by last-10 so formatting/country-code noise can't hide a
  // match. Checked even for short numbers — invalid_phone already blocks those.
  if (ctx.isDnc(digits.slice(-10))) reasons.push("dnc");

  // TCPA window in the LEAD's local time (stored zone → area code → org zone).
  // Due callbacks do NOT bypass this: the law doesn't care who asked.
  if (
    policy.window &&
    !isWithinCallingWindow(
      now,
      policy.window,
      resolveLeadTimezone(digits, lead.timezone, policy.window.timezone),
    )
  ) {
    reasons.push("outside_window");
  }

  // A live reservation by someone else blocks; an expired one is fair game, and
  // your own reservation is obviously yours to dial.
  if (
    lead.reservedBy &&
    lead.reservedBy !== actor.userId &&
    lead.reservedUntil &&
    ms(lead.reservedUntil) > nowMs
  ) {
    reasons.push("reserved_elsewhere");
  }

  if (ctx.activeCallLeadIds?.has(lead.id)) reasons.push("active_call");

  // The three pacing throttles — the ONLY rules a due callback bypasses.
  if (!isDueCallback) {
    if (policy.maxAttempts > 0 && lead.attemptCount >= policy.maxAttempts) {
      reasons.push("max_attempts");
    }
    if (
      policy.cooldownMinutes > 0 &&
      lead.lastAttemptAt &&
      ms(lead.lastAttemptAt) > nowMs - policy.cooldownMinutes * 60_000
    ) {
      reasons.push("cooldown");
    }
    if (lead.nextEligibleAt && ms(lead.nextEligibleAt) > nowMs) {
      reasons.push("not_yet_eligible");
    }
  }

  if (policy.campaignId && lead.campaignId !== policy.campaignId) {
    reasons.push("wrong_campaign");
  }
  if (policy.packId && lead.leadPackId !== policy.packId) {
    reasons.push("wrong_pack");
  }

  return { eligible: reasons.length === 0, reasons };
}

// null-vs-null and equal timestamps fall through to the next key, so the
// comparator is total and the sort is deterministic for any input order.
const compareNullableTs = (a: string | null | undefined, b: string | null | undefined): number => {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  const aNull = Number.isNaN(ta);
  const bNull = Number.isNaN(tb);
  if (aNull && bNull) return 0;
  if (aNull) return -1; // nulls first — "never" sorts before any timestamp
  if (bNull) return 1;
  return ta - tb;
};

/**
 * The claim RPC's ORDER BY, as a comparator — so client-side previews show the
 * exact order the server will hand leads out in. Never-dialed leads strictly
 * first (a fresh list shouldn't wait behind retries), then least-recently
 * attempted, then upload order, then id so the sort is stable across runs.
 *
 * -- LOCKSTEP: keep in sync with app_claim_dial_leads in supabase/schema.sql --
 */
export function compareDialOrder(
  a: LeadSnapshot & { createdAt?: string },
  b: LeadSnapshot & { createdAt?: string },
): number {
  const aNever = a.attemptCount === 0 && !a.lastAttemptAt;
  const bNever = b.attemptCount === 0 && !b.lastAttemptAt;
  if (aNever !== bNever) return aNever ? -1 : 1;

  const byAttempt = compareNullableTs(a.lastAttemptAt, b.lastAttemptAt);
  if (byAttempt !== 0) return byAttempt;

  const byCreated = compareNullableTs(a.createdAt, b.createdAt);
  if (byCreated !== 0) return byCreated;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
