// ─────────────────────────────────────────────────────────────────────────────
// Playbook definition contract — PURE types + validation. The executable form
// of docs/phase-2/playbook-and-orchestration-contracts.md; any divergence is a
// bug in one of the two.
//
// Two validation modes, per the contract's §1:
//   • validateDefinition (STRICT)  — the publish gate. Anything malformed,
//     unknown, or RESERVED fails with a reason list. A published playbook may
//     never promise what the engine can't safely execute.
//   • sanitizeDefinition (LENIENT) — the read path for already-stored blobs:
//     drops what it can't understand instead of erroring a screen, exactly
//     like FilterSpec does for stored filters.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFINITION_SCHEMA_VERSION = 1;

/** Execute kinds the v0 engine actually performs — the COMPLETE allow-list. */
export const EXECUTE_KINDS = [
  "create_work_item",
  "set_next_action",
  "escalate",
  "stop",
] as const;
export type ExecuteKind = (typeof EXECUTE_KINDS)[number];

/** Control constructs. */
export const CONTROL_KINDS = ["wait"] as const;

/**
 * RESERVED kinds: their workstreams haven't shipped, so publish REJECTS them —
 * actions are never inert. (Event names without emitters, by contrast, merely
 * never fire.)
 */
export const RESERVED_KINDS = [
  "send_sms",
  "place_ai_call",
  "send_email",
  "branch",
  "wait_for_event",
  "propose_stage",
] as const;

/** Trigger event vocabulary (emitters land with their workstreams). */
export const TRIGGER_EVENTS = [
  "lead.received",
  "opportunity.assigned",
  "call.completed",
  "message.received",
  "appointment.booked",
  "appointment.unconfirmed",
  "appointment.no_show",
  "inbound.callback",
  "sale.recorded",
  "install.stage_changed",
  "installed",
  "customer.issue",
] as const;

/** Stop-rule slugs. Two are ALWAYS enforced even when omitted (see resolve). */
export const STOP_RULES = [
  "contacted",
  "attempted",
  "replied",
  "callback_set",
  "callback_completed",
  "appointment_booked",
  "sold",
  "dnc_or_opt_out",
  "complaint",
  "open_issue",
  "opportunity_closed",
  "manager_pause",
] as const;
export type StopRule = (typeof STOP_RULES)[number];
export const ALWAYS_ENFORCED_STOP_RULES: StopRule[] = [
  "dnc_or_opt_out",
  "opportunity_closed",
];

export const WORK_ITEM_TYPES = [
  "first_call",
  "follow_up_call",
  "callback",
  "hot_response",
  "review",
  "custom",
] as const;

/** Condition-key whitelist by namespace prefix (contract §5). */
const CONDITION_KEYS = new Set([
  "opportunity.stage",
  "opportunity.op_status",
  "opportunity.priority",
  "opportunity.owner_id",
  "opportunity.campaign_id",
  "opportunity.source",
  "opportunity.attempt_count",
  "opportunity.contact_count",
  "opportunity.next_action_due_at",
  "opportunity.last_touched_at",
  "opportunity.hot_until",
  "opportunity.created_at",
  "derived.minutes_since_last_touch",
  "derived.callback_overdue_minutes",
  "derived.next_action_overdue_minutes",
  "derived.open_work_item_types",
  "touch.outcome",
  "touch.direction",
  "touch.channel",
]);
const CONDITION_KEY_PREFIXES = ["lead.", "custom."]; // ride the FilterSpec grammar

const COMPARATORS = new Set([
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "within_days",
  "older_than_days",
  "is_true",
  "is_false",
  "is_set",
  "is_empty",
]);

export interface Condition {
  key: string;
  cmp: string;
  value?: unknown;
}
export type ConditionGroup =
  | { all: (Condition | ConditionGroup)[] }
  | { any: (Condition | ConditionGroup)[] };

export type Trigger =
  | { kind: "event"; event: string; filter?: ConditionGroup }
  | { kind: "schedule"; cron: string; timezone?: "org" }
  | { kind: "sweep"; intervalMinutes: number };

export type Step =
  | {
      id: string;
      kind: "create_work_item";
      type: string;
      reason: string;
      dueInMinutes?: number;
      dueAtLocalTime?: string;
      priority?: number;
      queue?: string;
      requiresApproval?: boolean;
    }
  | {
      id: string;
      kind: "set_next_action";
      next: { kind: string; dueInMinutes?: number; dueInDays?: number };
      requiresApproval?: boolean;
    }
  | {
      id: string;
      kind: "escalate";
      to: "owner" | "managers" | "queue";
      reason: string;
      requiresApproval?: boolean;
    }
  | { id: string; kind: "stop"; reason?: string }
  | {
      id: string;
      kind: "wait";
      for:
        | { minutes?: number; hours?: number; days?: number }
        | { untilLocalTime: string; timezone?: "lead" | "org" };
    };

export interface PlaybookDefinition {
  schemaVersion: number;
  key: string;
  name: string;
  trigger: Trigger;
  eligibility?: ConditionGroup;
  steps: Step[];
  stop: { rules: string[]; maxAttempts?: number; stopOnReassign?: boolean };
  caps?: {
    touchesPerDay?: number;
    touchesPer7Days?: number;
  };
  reentry?: { allow: boolean; cooldownHours?: number };
  routing?: { queue?: string; escalateTo?: "owner" | "managers" | "queue" };
}

const MAX_STEPS = 30;
const MAX_CONDITIONS = 32;
const MAX_DEPTH = 3;
const SLUG = /^[a-z][a-z0-9_]{0,63}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateGroup(
  g: unknown,
  path: string,
  errs: string[],
  depth: number,
  counter: { n: number },
): void {
  if (depth > MAX_DEPTH) {
    errs.push(`${path}: nesting deeper than ${MAX_DEPTH}`);
    return;
  }
  const obj = g as Record<string, unknown>;
  const list = (obj?.all ?? obj?.any) as unknown[];
  const hasOne =
    obj != null &&
    typeof obj === "object" &&
    ("all" in obj) !== ("any" in obj) &&
    Array.isArray(list);
  if (!hasOne) {
    errs.push(`${path}: must be { all: [...] } or { any: [...] }`);
    return;
  }
  for (const [i, item] of list.entries()) {
    const p = `${path}[${i}]`;
    const it = item as Record<string, unknown>;
    if (it && typeof it === "object" && ("all" in it || "any" in it)) {
      validateGroup(it, p, errs, depth + 1, counter);
      continue;
    }
    counter.n++;
    if (counter.n > MAX_CONDITIONS) {
      errs.push(`${path}: more than ${MAX_CONDITIONS} conditions`);
      return;
    }
    const key = String(it?.key ?? "");
    const cmp = String(it?.cmp ?? "");
    if (
      !CONDITION_KEYS.has(key) &&
      !CONDITION_KEY_PREFIXES.some((pre) => key.startsWith(pre) && key.length > pre.length)
    ) {
      errs.push(`${p}: unknown condition key "${key}"`);
    }
    if (!COMPARATORS.has(cmp)) errs.push(`${p}: unknown comparator "${cmp}"`);
  }
}

/**
 * STRICT publish validation. Empty errors ⇒ publishable. Every message is
 * operator-facing (the Studio shows them verbatim in P2.10).
 */
export function validateDefinition(raw: unknown): { ok: boolean; errors: string[] } {
  const errs: string[] = [];
  const d = raw as Partial<PlaybookDefinition> | null;
  if (!d || typeof d !== "object") return { ok: false, errors: ["definition must be an object"] };

  if (d.schemaVersion !== DEFINITION_SCHEMA_VERSION) {
    errs.push(`schemaVersion must be ${DEFINITION_SCHEMA_VERSION}`);
  }
  if (!SLUG.test(String(d.key ?? ""))) errs.push("key must be a slug (a-z, 0-9, _)");
  if (!String(d.name ?? "").trim()) errs.push("name is required");

  // Trigger
  const t = d.trigger as Trigger | undefined;
  if (!t || typeof t !== "object") {
    errs.push("trigger is required");
  } else if (t.kind === "event") {
    if (!(TRIGGER_EVENTS as readonly string[]).includes(t.event)) {
      errs.push(`trigger.event "${t.event}" is not in the event vocabulary`);
    }
    if (t.filter) validateGroup(t.filter, "trigger.filter", errs, 1, { n: 0 });
  } else if (t.kind === "sweep") {
    const m = Number(t.intervalMinutes);
    if (!Number.isFinite(m) || m < 5 || m > 24 * 60) {
      errs.push("trigger.intervalMinutes must be 5–1440");
    }
  } else if (t.kind === "schedule") {
    if (!/^\S+ \S+ \S+ \S+ \S+$/.test(String(t.cron ?? ""))) {
      errs.push("trigger.cron must be a 5-field cron expression");
    }
  } else {
    errs.push("trigger.kind must be event | schedule | sweep");
  }

  // Eligibility
  if (d.eligibility) validateGroup(d.eligibility, "eligibility", errs, 1, { n: 0 });

  // Steps
  const steps = Array.isArray(d.steps) ? d.steps : [];
  if (steps.length === 0 || steps.length > MAX_STEPS) {
    errs.push(`steps must contain 1–${MAX_STEPS} entries`);
  }
  const ids = new Set<string>();
  for (const [i, s] of steps.entries()) {
    const p = `steps[${i}]`;
    const step = s as Record<string, unknown>;
    const id = String(step?.id ?? "");
    const kind = String(step?.kind ?? "");
    if (!SLUG.test(id)) errs.push(`${p}: id must be a slug`);
    if (ids.has(id)) errs.push(`${p}: duplicate id "${id}"`);
    ids.add(id);

    if ((RESERVED_KINDS as readonly string[]).includes(kind)) {
      errs.push(
        `${p}: "${kind}" is reserved — its workstream hasn't shipped, so a published playbook may not promise it`,
      );
      continue;
    }
    if (kind === "create_work_item") {
      if (!(WORK_ITEM_TYPES as readonly string[]).includes(String(step.type))) {
        errs.push(`${p}: unknown work-item type "${String(step.type)}"`);
      }
      if (!SLUG.test(String(step.reason ?? ""))) errs.push(`${p}: reason must be a slug`);
      if (step.dueAtLocalTime != null && !HHMM.test(String(step.dueAtLocalTime))) {
        errs.push(`${p}: dueAtLocalTime must be HH:MM`);
      }
    } else if (kind === "set_next_action") {
      const next = step.next as Record<string, unknown> | undefined;
      if (!next || !SLUG.test(String(next.kind ?? ""))) {
        errs.push(`${p}: next.kind must be a slug`);
      }
    } else if (kind === "escalate") {
      if (!["owner", "managers", "queue"].includes(String(step.to))) {
        errs.push(`${p}: to must be owner | managers | queue`);
      }
      if (!SLUG.test(String(step.reason ?? ""))) errs.push(`${p}: reason must be a slug`);
    } else if (kind === "wait") {
      const f = step.for as Record<string, unknown> | undefined;
      const hasDelta =
        f && ["minutes", "hours", "days"].some((k) => Number(f[k]) > 0);
      const hasLocal = f && HHMM.test(String(f.untilLocalTime ?? ""));
      if (!hasDelta && !hasLocal) {
        errs.push(`${p}: wait.for needs minutes/hours/days or untilLocalTime`);
      }
    } else if (kind === "stop") {
      // reason optional
    } else {
      errs.push(`${p}: unknown step kind "${kind}"`);
    }
  }

  // Stop policy — required, ≥1 rule, all known.
  const stop = d.stop as PlaybookDefinition["stop"] | undefined;
  const rules = Array.isArray(stop?.rules) ? stop!.rules : [];
  if (rules.length === 0) errs.push("stop.rules must name at least one stop rule");
  for (const r of rules) {
    if (!(STOP_RULES as readonly string[]).includes(r)) {
      errs.push(`stop.rules: unknown rule "${r}"`);
    }
  }

  return { ok: errs.length === 0, errors: errs };
}

/**
 * The effective stop-rule set: whatever the definition names PLUS the two
 * always-enforced rules — DNC/opt-out and a closed opportunity stop every
 * playbook, whatever its author wrote.
 */
export function resolveStopRules(def: Pick<PlaybookDefinition, "stop">): Set<StopRule> {
  const out = new Set<StopRule>(ALWAYS_ENFORCED_STOP_RULES);
  for (const r of def.stop?.rules ?? []) {
    if ((STOP_RULES as readonly string[]).includes(r)) out.add(r as StopRule);
  }
  return out;
}
