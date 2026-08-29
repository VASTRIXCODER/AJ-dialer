// ─────────────────────────────────────────────────────────────────────────────
// Turning the automation's own records into sentences — PURE, no I/O.
//
// Three append-only logs describe what the system did to a record, and all
// three are written in schema language: `stage_changed`, `skipped_policy`,
// `dnc_or_opt_out`, `create_work_item`. None of that may reach a screen. This
// is the one place that translation happens, so the Automation tab and any
// later surface can never describe the same row two different ways.
//
// Unknown values degrade to a readable softening of the slug rather than
// throwing or rendering blank: these tables carry author-supplied reasons and
// step ids, so the set is genuinely open.
// ─────────────────────────────────────────────────────────────────────────────

import { STAGE_LABELS } from "./why-now";

/** Softens an unknown slug: `callback_breach` → "Callback breach". */
export function humanizeSlug(slug: string): string {
  const words = String(slug ?? "").replace(/[_:]+/g, " ").trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const stage = (key: string): string => STAGE_LABELS[key] ?? humanizeSlug(key);

/** Human copy for a work-item type — never a raw schema name on screen. */
const WORK_TYPE_LABEL: Record<string, string> = {
  first_call: "First call",
  follow_up_call: "Follow-up call",
  callback: "Promised callback",
  hot_response: "Hot response",
  review: "Review",
  custom: "Task",
};

export function workTypeLabel(type: string): string {
  return WORK_TYPE_LABEL[type] ?? humanizeSlug(type);
}

/** Playbook `reason` slugs are author-supplied, so this softens rather than maps. */
export function workReasonLabel(reason: string): string {
  return humanizeSlug(reason);
}

/** Who did it, in words. `system` is the automation itself. */
export function actorLabel(actorKind: string, actorName?: string | null): string {
  if (actorName) return actorName;
  switch (actorKind) {
    case "system":
      return "Automation";
    case "ai":
      return "The AI agent";
    case "manager":
      return "A manager";
    case "rep":
      return "A rep";
    default:
      return humanizeSlug(actorKind) || "Someone";
  }
}

/** Why a stage moved, when the writer said. Empty when it said nothing useful. */
const STAGE_REASON: Record<string, string> = {
  crm_board: "moved by hand on the pipeline board",
  sms_stop: "they replied STOP",
  disposition: "from the call outcome",
  phase1_backfill: "reconstructed from earlier history",
  intake: "on intake",
};

export interface OpportunityEventCopy {
  title: string;
  detail: string;
  /** Drives the timeline's dot colour. */
  tone: "neutral" | "primary" | "accent" | "success" | "warning" | "danger";
}

export function opportunityEventCopy(event: {
  type: string;
  actorKind: string;
  actorName?: string | null;
  fromStage?: string | null;
  toStage?: string | null;
  detail?: Record<string, unknown> | null;
}): OpportunityEventCopy {
  const who = actorLabel(event.actorKind, event.actorName);
  const reasonKey = String(event.detail?.reason ?? "");
  const because = STAGE_REASON[reasonKey] ?? (reasonKey ? humanizeSlug(reasonKey) : "");

  if (event.type === "stage_changed" && event.toStage) {
    const to = stage(event.toStage);
    const from = event.fromStage ? stage(event.fromStage) : null;
    return {
      title: from ? `${from} → ${to}` : `Moved to ${to}`,
      detail: [who, because].filter(Boolean).join(" · "),
      tone:
        event.toStage === "sold"
          ? "success"
          : event.toStage === "dnc_suppressed"
            ? "danger"
            : event.toStage === "lost"
              ? "warning"
              : "accent",
    };
  }

  if (event.type === "owner_changed") {
    return { title: "Owner changed", detail: who, tone: "accent" };
  }

  // An unrecognised type is still real history — say what it was rather than
  // hiding the row, which would make the log look shorter than it is.
  return { title: humanizeSlug(event.type), detail: who, tone: "neutral" };
}

// ── Playbook step executions ─────────────────────────────────────────────────

const STEP_KIND: Record<string, string> = {
  create_work_item: "Created a task",
  set_next_action: "Set the next action",
  escalate: "Raised an alert",
  stop: "Stopped",
  wait: "Waited",
};

export interface ExecutionCopy {
  title: string;
  detail: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

/**
 * A step that ran, or didn't. `skipped_policy` is the interesting one: it is
 * the automation explaining that it deliberately held back — a frequency cap,
 * a stop rule — and until this rendered anywhere, that decision was invisible
 * and the playbook simply looked idle.
 */
export function executionCopy(exec: {
  stepIndex: number;
  actionKind: string;
  status: string;
  detail?: Record<string, unknown> | null;
  error?: string | null;
}): ExecutionCopy {
  const what = STEP_KIND[exec.actionKind] ?? humanizeSlug(exec.actionKind);
  const step = `Step ${exec.stepIndex + 1}`;

  if (exec.status === "skipped_policy") {
    const why = String(exec.detail?.reason ?? exec.detail?.policy ?? "");
    return {
      title: `${step} · ${what} — held back`,
      detail: why ? humanizeSlug(why) : "A policy stopped this step from running.",
      tone: "warning",
    };
  }
  if (exec.status === "failed") {
    return {
      title: `${step} · ${what} — failed`,
      // The error is operator-facing; show it rather than a shrug.
      detail: exec.error ? String(exec.error).slice(0, 200) : "No reason was recorded.",
      tone: "danger",
    };
  }
  return { title: `${step} · ${what}`, detail: "", tone: "success" };
}

// ── Playbook instances ───────────────────────────────────────────────────────

/** Why a run ended. These are the engine's own stop-rule slugs. */
const STOPPED_BECAUSE: Record<string, string> = {
  contacted: "they were reached",
  attempted: "someone attempted the call",
  replied: "they replied",
  callback_set: "a callback was booked",
  callback_completed: "the callback was made",
  appointment_booked: "an appointment was booked",
  sold: "the deal was won",
  dnc_or_opt_out: "they asked not to be contacted",
  complaint: "a complaint was raised",
  open_issue: "a service issue is open",
  opportunity_closed: "the record was closed",
  manager_pause: "a manager paused automation",
  reassigned: "the record changed hands",
};

export function instanceStatusCopy(inst: {
  status: string;
  currentStep: number;
  stoppedReason?: string | null;
}): { label: string; detail: string; tone: "neutral" | "primary" | "success" | "warning" } {
  switch (inst.status) {
    case "active":
      return {
        label: "Running",
        detail: `On step ${inst.currentStep + 1}`,
        tone: "primary",
      };
    case "waiting":
      return {
        label: "Waiting",
        detail: `Paused before step ${inst.currentStep + 1}`,
        tone: "primary",
      };
    case "completed":
      return { label: "Finished", detail: "Every step ran.", tone: "success" };
    case "stopped": {
      const why = inst.stoppedReason
        ? (STOPPED_BECAUSE[inst.stoppedReason] ?? humanizeSlug(inst.stoppedReason))
        : "";
      return {
        label: "Stopped",
        // A stop is usually GOOD news — the outcome the playbook was chasing
        // happened, so it got out of the way. Say which, or it reads as a fault.
        detail: why ? `Stopped because ${why}.` : "Stopped.",
        tone: "success",
      };
    }
    case "failed":
      return { label: "Failed", detail: "The run hit an error.", tone: "warning" };
    default:
      return { label: humanizeSlug(inst.status), detail: "", tone: "neutral" };
  }
}
