// ─────────────────────────────────────────────────────────────────────────────
// Sales lifecycle stage machine — PURE (no server-only, no I/O), the TS twin
// of the `opportunities.stage` CHECK constraint in supabase/schema.sql PART 37.
// -- LOCKSTEP: keep the STAGES list in sync with that constraint. --
//
// Design authority: docs/phase-2/opportunity-domain-and-state-machines.md §3.
// The rules that matter:
//   • forward moves are free; BACKWARD moves need an explicit human override
//     (`allowRegress`) — a late webhook can never demote a stage;
//   • `sold` is never reachable by AI or conversation text — only a manager
//     or the (future) trusted fulfillment source;
//   • `dnc_suppressed` is reachable from anywhere and only a human leaves it.
// ─────────────────────────────────────────────────────────────────────────────

import type { LeadStatus } from "../types";

/** Progressive stages, in rank order. */
export const PROGRESSIVE_STAGES = [
  "new",
  "assigned",
  "attempting",
  "contacted",
  "interested",
  "appointment_booked",
  "appointment_completed",
  "sold",
] as const;

/** Holding / terminal alternates (rank −1: outside the forward ladder). */
export const ALTERNATE_STAGES = [
  "nurture",
  "lost",
  "invalid",
  "dnc_suppressed",
  "exhausted",
  "duplicate",
  "disqualified",
] as const;

export const STAGES = [...PROGRESSIVE_STAGES, ...ALTERNATE_STAGES] as const;
export type OpportunityStage = (typeof STAGES)[number];

export type StageActor = "rep" | "manager" | "ai" | "system" | "system_fulfillment";

const RANK: Record<string, number> = Object.fromEntries(
  PROGRESSIVE_STAGES.map((s, i) => [s, i]),
);

export function isOpportunityStage(v: unknown): v is OpportunityStage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

/** Rank on the forward ladder; −1 for alternates. */
export function stageRank(stage: OpportunityStage): number {
  return RANK[stage] ?? -1;
}

export type TransitionVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "same_stage"
        | "unknown_stage"
        | "regress_needs_human"
        | "sold_needs_trusted_actor"
        | "leave_dnc_needs_human";
    };

/**
 * May `actor` move an opportunity `from` → `to`?
 *
 * `allowRegress` is the explicit human override for backward moves (a manager
 * correcting a mis-staged record) — it never overrides the sold/DNC gates.
 */
export function canTransition(
  from: OpportunityStage,
  to: OpportunityStage,
  actor: StageActor,
  opts?: { allowRegress?: boolean },
): TransitionVerdict {
  if (!isOpportunityStage(from) || !isOpportunityStage(to)) {
    return { ok: false, reason: "unknown_stage" };
  }
  if (from === to) return { ok: false, reason: "same_stage" };

  // Leaving suppression is a human decision, full stop.
  if (from === "dnc_suppressed" && actor !== "manager") {
    return { ok: false, reason: "leave_dnc_needs_human" };
  }

  // Sold requires the trusted source or an authorized human — never AI, never
  // a generic system writer, whatever `allowRegress` says (§5 of the prompt:
  // "Do not infer Sold from conversation text alone").
  if (to === "sold" && actor !== "manager" && actor !== "system_fulfillment") {
    return { ok: false, reason: "sold_needs_trusted_actor" };
  }

  // Entering an alternate (nurture/lost/dnc/…) is always a lateral move.
  if (stageRank(to) === -1) return { ok: true };

  // Forward on the ladder (including climbing OUT of an alternate) is free.
  const fromRank = stageRank(from);
  if (fromRank === -1 || stageRank(to) > fromRank) return { ok: true };

  // Backward on the ladder: humans only, and only deliberately.
  if (opts?.allowRegress && (actor === "manager" || actor === "rep")) {
    return { ok: true };
  }
  return { ok: false, reason: "regress_needs_human" };
}

/**
 * The Phase 1 `leads.status` → stage mapping (backfill + one-way sync).
 * -- LOCKSTEP: keep in sync with the backfill CASE in schema.sql PART 37. --
 */
export function stageForLeadStatus(
  status: LeadStatus,
  assigned: boolean,
): OpportunityStage {
  switch (status) {
    case "new":
      return assigned ? "assigned" : "new";
    case "no_answer":
      return "attempting";
    case "contacted":
    case "callback":
      return "contacted";
    case "qualified":
      return "interested";
    case "appointment":
      return "appointment_booked";
    case "bills_fine":
      return "nurture";
    case "not_interested":
      return "lost";
    case "dnc":
      return "dnc_suppressed";
    default:
      return "new";
  }
}

/** Stages whose opportunities are CLOSED operationally (op_status mapping).
 *  `sold` deliberately stays open — fulfillment mirroring (P2.7) works it. */
export function isClosingStage(stage: OpportunityStage): boolean {
  return stage === "lost" || stage === "dnc_suppressed";
}
