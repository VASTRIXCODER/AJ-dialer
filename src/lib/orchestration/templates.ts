// ─────────────────────────────────────────────────────────────────────────────
// P2.1 seed playbook templates — validated JSON an org clones into a DRAFT
// (configurable starting points, never hard-coded behavior — phase_two.md §18).
// Every template must pass validateDefinition; tests/playbook-definition.test.ts
// enforces that, so a contract drift breaks the build instead of production.
// Source of record for the shapes: docs/phase-2/playbook-and-orchestration-
// contracts.md §11.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlaybookDefinition } from "./definition";

/** Escalation only fires if the lead is STILL untouched — via the `attempted`
 *  stop rule, v0's branching mechanism (the engine is linear on purpose). */
export const SPEED_TO_LEAD: PlaybookDefinition = {
  schemaVersion: 1,
  key: "speed_to_lead",
  name: "Speed to lead",
  trigger: { kind: "event", event: "lead.received" },
  eligibility: {
    all: [
      { key: "opportunity.stage", cmp: "in", value: ["new", "assigned"] },
      { key: "lead.dnc", cmp: "is_false" },
    ],
  },
  steps: [
    {
      id: "first_touch",
      kind: "create_work_item",
      type: "first_call",
      reason: "speed_to_lead",
      dueInMinutes: 5,
      priority: 90,
    },
    { id: "grace", kind: "wait", for: { minutes: 15 } },
    { id: "alert", kind: "escalate", to: "managers", reason: "speed_to_lead_breach" },
  ],
  stop: {
    rules: ["attempted", "dnc_or_opt_out", "opportunity_closed", "manager_pause"],
    stopOnReassign: false,
  },
};

/** Multi-touch no-answer follow-up: capped, lead-local timing, then parks the
 *  opportunity on a nurture review date instead of dropping it. */
export const NO_ANSWER_FOLLOW_UP: PlaybookDefinition = {
  schemaVersion: 1,
  key: "no_answer_follow_up",
  name: "No-answer follow-up",
  trigger: {
    kind: "event",
    event: "call.completed",
    filter: {
      all: [{ key: "touch.outcome", cmp: "in", value: ["no_answer", "busy", "voicemail"] }],
    },
  },
  eligibility: {
    all: [
      { key: "opportunity.stage", cmp: "in", value: ["attempting", "contacted"] },
      { key: "opportunity.attempt_count", cmp: "lt", value: 6 },
    ],
  },
  steps: [
    { id: "w1", kind: "wait", for: { untilLocalTime: "10:00", timezone: "lead" } },
    {
      id: "t1",
      kind: "create_work_item",
      type: "follow_up_call",
      reason: "no_answer_retry",
      priority: 60,
    },
    { id: "w2", kind: "wait", for: { days: 2 } },
    {
      id: "t2",
      kind: "create_work_item",
      type: "follow_up_call",
      reason: "no_answer_retry",
      priority: 50,
    },
    {
      id: "park",
      kind: "set_next_action",
      next: { kind: "nurture_review", dueInDays: 30 },
    },
  ],
  stop: {
    rules: [
      "contacted",
      "callback_set",
      "appointment_booked",
      "dnc_or_opt_out",
      "opportunity_closed",
      "manager_pause",
    ],
    maxAttempts: 4,
  },
  caps: { touchesPerDay: 1, touchesPer7Days: 3 },
  reentry: { allow: true, cooldownHours: 72 },
};

/** Promised-callback protection — a sweep where eligibility IS the trigger. */
export const PROMISED_CALLBACK_PROTECTION: PlaybookDefinition = {
  schemaVersion: 1,
  key: "promised_callback_protection",
  name: "Promised-callback protection",
  trigger: { kind: "sweep", intervalMinutes: 15 },
  eligibility: {
    all: [{ key: "derived.callback_overdue_minutes", cmp: "gte", value: 10 }],
  },
  steps: [
    { id: "nudge_owner", kind: "escalate", to: "owner", reason: "promised_callback_overdue" },
    { id: "grace", kind: "wait", for: { minutes: 60 } },
    {
      id: "hot",
      kind: "create_work_item",
      type: "hot_response",
      reason: "callback_breach",
      queue: "hot",
      priority: 95,
    },
    { id: "alert", kind: "escalate", to: "managers", reason: "callback_breach" },
  ],
  stop: {
    rules: [
      "callback_completed",
      "contacted",
      "dnc_or_opt_out",
      "opportunity_closed",
      "manager_pause",
    ],
  },
  reentry: { allow: true, cooldownHours: 24 },
};

export const SEED_TEMPLATES: PlaybookDefinition[] = [
  SPEED_TO_LEAD,
  NO_ANSWER_FOLLOW_UP,
  PROMISED_CALLBACK_PROTECTION,
];
