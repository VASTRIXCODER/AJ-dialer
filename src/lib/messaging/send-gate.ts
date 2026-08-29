// ─────────────────────────────────────────────────────────────────────────────
// The single place that decides whether a message may leave — PURE, no I/O.
//
// Modelled on dialer/eligibility.ts, and it shares that module's most important
// property: it returns EVERY reason a send is refused, never the first one.
// "Why can't I text this person?" is a question with a complete answer, and a
// gate that reveals one blocker at a time turns fixing a record into a guessing
// game played one round trip at a time.
//
// It is evaluated TWICE: once when a message is proposed, and again at the
// drain immediately before the provider call. The second evaluation is the only
// reason STOP actually works — the window between a human approving a message
// and the carrier accepting it is precisely where an opt-out lands.
//
// A message that passes at proposal and fails at drain becomes `blocked`, never
// `failed`. They are different events: one is the system correctly protecting
// someone, the other is something breaking. Conflating them would have every
// honoured opt-out light up the failure alert.
// ─────────────────────────────────────────────────────────────────────────────

import { consentDenial, type ConsentScope, type ConsentSnapshot } from "../consent/state";
import { isWithinOrgHours } from "../dialer/schedule";

export type SendDenial =
  // Compliance — never deferred, only refused.
  | "dnc"
  | "no_consent"
  | "consent_revoked"
  | "consent_scope"
  // Timing — a HOLD, not a refusal. Carries a deferUntil.
  | "quiet_hours"
  | "cap_contact_day"
  | "cap_contact_week"
  | "cap_org_day"
  // Configuration — the message can never go as it stands.
  | "messaging_not_configured"
  | "no_recipient"
  | "no_sender"
  | "empty_body"
  | "template_not_published"
  | "unresolved_variables"
  // Kill switches.
  | "messaging_paused"
  | "org_messaging_off"
  // Not a failure: a message waiting for a human is working as designed.
  | "needs_human_approval";

/** Denials that mean "not yet" rather than "not ever". */
const DEFERRABLE = new Set<SendDenial>([
  "quiet_hours",
  "cap_contact_day",
  "cap_contact_week",
  "cap_org_day",
]);

export function isDeferrable(denial: SendDenial): boolean {
  return DEFERRABLE.has(denial);
}

export interface QuietHours {
  /** Local hour the window OPENS (inclusive). */
  startHour: number;
  /** Local hour it CLOSES (exclusive). */
  endHour: number;
}

/**
 * Default 9am–8pm, deliberately tighter than the statutory 8am–9pm.
 *
 * The hour at each end is the one most likely to be wrong: `leads.timezone`
 * defaults to America/Los_Angeles in the schema and resolveLeadTimezone trusts
 * any value containing "/", so a Texas record imported without a zone is
 * evaluated as Pacific. That is harmless for a morning call and a real exposure
 * at the evening boundary — 8pm Pacific is 11pm Eastern. An hour of margin at
 * each end costs almost nothing and absorbs exactly that error.
 */
export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 9, endHour: 20 };

export interface SendGateInput {
  now: Date;
  /** The recipient. Absent or unusable is a hard refusal. */
  toPhone: string;
  /** The number this thread sends from. Sticky per thread — never rotated. */
  senderNumber: string | null;
  body: string;

  /** Suppression list membership. Separate from consent, and both must pass. */
  isDnc: boolean;
  consent: ConsentSnapshot | null;
  requiredScope: ConsentScope;

  /**
   * Every timezone this person might plausibly be in — the stored one and the
   * one their area code implies. When they disagree we do NOT pick; the message
   * must be inside the window in ALL of them. That is the bracketing: the
   * earliest-closing zone governs the evening and the latest-opening governs
   * the morning, which falls out of requiring all of them to agree.
   */
  candidateTimezones: string[];
  quietHours: QuietHours | null;

  /** Sends to THIS person that the carrier accepted, in each window. */
  contactSentToday: number;
  contactSentThisWeek: number;
  /** Sends the whole org made today — the spend ceiling. */
  orgSentToday: number;
  caps: {
    perContactPerDay: number;
    perContactPer7Days: number;
    perOrgPerDay: number;
  };
  /** When the oldest counted send falls out of each window, if known. */
  contactDayWindowClearsAt?: Date | null;
  contactWeekWindowClearsAt?: Date | null;

  messagingConfigured: boolean;
  orgMessagingEnabled: boolean;
  /** Global kill switch. Flipping it must leave approved rows intact. */
  messagingPaused: boolean;

  /** Templated sends only: the live version must exist and fully render. */
  templateRequired: boolean;
  templatePublished: boolean;
  unresolvedVariables: string[];

  /** The named human. Null means it is still waiting for one. */
  approvedBy: string | null;
}

export interface SendVerdict {
  allowed: boolean;
  /** All of them, in a stable order. Empty when allowed. */
  denials: SendDenial[];
  /**
   * Set when EVERY denial is deferrable — the message is fine, the moment is
   * not. Null when anything is a hard refusal, because there is no later time
   * at which an opt-out becomes acceptable.
   */
  deferUntil: Date | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Is `at` inside the quiet-hours window in every candidate zone?
 * An empty zone list means we could not resolve one at all, which is treated as
 * outside the window — we do not send into a timezone we cannot name.
 */
export function withinQuietHours(
  at: Date,
  quietHours: QuietHours | null,
  timezones: string[],
): boolean {
  if (!quietHours) return true;
  if (!timezones.length) return false;
  const hours = {
    startHour: quietHours.startHour,
    endHour: quietHours.endHour,
    days: [] as number[],
  };
  return timezones.every((tz) => isWithinOrgHours(at, hours, tz));
}

/**
 * The next moment the window is open in every candidate zone. Steps in 15
 * minute increments — the window boundaries are whole hours, so this lands on
 * the opening minute rather than approximating it, and 48 hours of steps is
 * 192 iterations of a pure comparison.
 */
export function nextQuietHoursOpening(
  from: Date,
  quietHours: QuietHours | null,
  timezones: string[],
): Date | null {
  if (withinQuietHours(from, quietHours, timezones)) return from;
  const STEP = 15 * 60_000;
  for (let t = from.getTime() + STEP; t <= from.getTime() + 2 * DAY_MS; t += STEP) {
    const at = new Date(t);
    if (withinQuietHours(at, quietHours, timezones)) return at;
  }
  // No opening within two days means the window is unusable (a degenerate
  // config). Refuse rather than inventing a time.
  return null;
}

export function evaluateSendGate(input: SendGateInput): SendVerdict {
  const denials: SendDenial[] = [];
  const defers: Date[] = [];
  let undeferrableHold = false;

  // ── Configuration ─────────────────────────────────────────────────────────
  if (!input.messagingConfigured) denials.push("messaging_not_configured");
  if (!input.orgMessagingEnabled) denials.push("org_messaging_off");
  if (input.messagingPaused) denials.push("messaging_paused");
  if (!input.toPhone.trim()) denials.push("no_recipient");
  if (!input.senderNumber?.trim()) denials.push("no_sender");
  if (!input.body.trim()) denials.push("empty_body");

  if (input.templateRequired && !input.templatePublished) {
    denials.push("template_not_published");
  }
  if (input.unresolvedVariables.length > 0) {
    // A hard refusal at proposal time. "Hi {{firstName}}" must never be a thing
    // a human is asked to approve, let alone a thing a customer receives.
    denials.push("unresolved_variables");
  }

  // ── Compliance. Both gate; neither replaces the other. ────────────────────
  if (input.isDnc) denials.push("dnc");
  const consentFailure = consentDenial(input.consent, input.requiredScope);
  if (consentFailure) denials.push(consentFailure);

  // ── Timing ────────────────────────────────────────────────────────────────
  if (!withinQuietHours(input.now, input.quietHours, input.candidateTimezones)) {
    denials.push("quiet_hours");
    const opening = nextQuietHoursOpening(input.now, input.quietHours, input.candidateTimezones);
    if (opening) defers.push(opening);
    else undeferrableHold = true;
  }

  // ── Frequency. Counted against sends the CARRIER ACCEPTED, so a blocked or
  //    failed message never burns the customer's allowance while one that
  //    reached them always does.
  if (input.caps.perContactPerDay > 0 && input.contactSentToday >= input.caps.perContactPerDay) {
    denials.push("cap_contact_day");
    const clears = input.contactDayWindowClearsAt ?? new Date(input.now.getTime() + DAY_MS);
    defers.push(clears);
  }
  if (
    input.caps.perContactPer7Days > 0 &&
    input.contactSentThisWeek >= input.caps.perContactPer7Days
  ) {
    denials.push("cap_contact_week");
    const clears = input.contactWeekWindowClearsAt ?? new Date(input.now.getTime() + 7 * DAY_MS);
    defers.push(clears);
  }
  if (input.caps.perOrgPerDay > 0 && input.orgSentToday >= input.caps.perOrgPerDay) {
    denials.push("cap_org_day");
    // The org ceiling resets on the hour rather than at a stored timestamp;
    // an hour's wait is a cheap and obviously-safe retry.
    defers.push(new Date(input.now.getTime() + HOUR_MS));
  }

  // ── The named human. Listed LAST because it is not a fault: a message
  //    waiting for approval is the design working, and it must never be the
  //    headline reason when a real blocker is also present.
  if (!input.approvedBy) denials.push("needs_human_approval");

  if (denials.length === 0) {
    return { allowed: true, denials: [], deferUntil: null };
  }

  // A deferral is only offered when EVERY reason is one that time fixes.
  // Waiting does not make an opt-out acceptable, and pairing a hold with a
  // compliance refusal would schedule a retry of something that must not go.
  const allDeferrable = denials.every(isDeferrable);
  const deferUntil =
    allDeferrable && !undeferrableHold && defers.length
      ? new Date(Math.max(...defers.map((d) => d.getTime())))
      : null;

  return { allowed: false, denials, deferUntil };
}

/** Operator-facing copy. Shown verbatim; no schema words reach a screen. */
export const SEND_DENIAL_COPY: Record<SendDenial, string> = {
  dnc: "This number is on the Do-Not-Call list.",
  no_consent:
    "No recorded permission to message this number. Capture consent on a call, or wait for them to text first.",
  consent_revoked: "They asked to stop receiving messages.",
  consent_scope: "They agreed to messages about their own appointment, not to marketing.",
  quiet_hours: "It's outside messaging hours where they are.",
  cap_contact_day: "They've already had the day's limit of messages.",
  cap_contact_week: "They've already had this week's limit of messages.",
  cap_org_day: "The workspace has reached its daily send limit.",
  messaging_not_configured: "Messaging isn't connected for this workspace.",
  org_messaging_off: "Messaging is switched off for this workspace.",
  messaging_paused: "Messaging is paused platform-wide.",
  no_recipient: "This record has no usable phone number.",
  no_sender: "No sending number is assigned to this conversation.",
  empty_body: "The message is empty.",
  template_not_published: "The template this message uses isn't published.",
  unresolved_variables:
    "The message still has unfilled placeholders. It can't be sent until every one resolves.",
  needs_human_approval: "Waiting for someone to approve it.",
};

/** The one reason worth leading with when several apply. */
export function primaryDenial(denials: SendDenial[]): SendDenial | null {
  if (!denials.length) return null;
  // Compliance first — it is the reason that matters and the only one that can
  // never be waited out. `needs_human_approval` is deliberately last: it is not
  // a fault, and leading with it would hide a real blocker behind a queue.
  const order: SendDenial[] = [
    "dnc",
    "consent_revoked",
    "no_consent",
    "consent_scope",
    "messaging_paused",
    "org_messaging_off",
    "messaging_not_configured",
    "no_recipient",
    "no_sender",
    "empty_body",
    "unresolved_variables",
    "template_not_published",
    "quiet_hours",
    "cap_contact_day",
    "cap_contact_week",
    "cap_org_day",
    "needs_human_approval",
  ];
  for (const d of order) if (denials.includes(d)) return d;
  return denials[0];
}
