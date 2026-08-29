// ─────────────────────────────────────────────────────────────────────────────
// Pipeline board lanes — PURE (no server-only, no I/O).
//
// The stage machine has 15 stages, which is the right resolution for a state
// machine and far too much for a board a human reads at a glance. This collapses
// them into six lanes that answer one question per lane: has anyone touched
// this, is someone working it, has the customer committed to something, did we
// win it, did we deliberately set it aside, or is it over.
//
// `nurture` gets its own lane rather than joining the closed ones. It reads like
// an ending but `isClosingStage` says otherwise: only `lost` and `dnc_suppressed`
// close an opportunity, and the no-answer playbook deliberately parks records
// there with a 30-day review date. Filing that population under "Closed" would
// hide live, re-workable pipeline behind a word that means "don't look here".
//
// -- LOCKSTEP: every stage in STAGES must appear in exactly one lane. A test
//    enforces both halves, so adding a stage upstream breaks the build here
//    rather than silently dropping its cards off the board. --
// ─────────────────────────────────────────────────────────────────────────────

import {
  canTransition,
  STAGES,
  type OpportunityStage,
  type StageActor,
} from "./stage-machine";

export const BOARD_LANES = [
  "new",
  "working",
  "committed",
  "won",
  "parked",
  "closed",
] as const;
export type BoardLane = (typeof BOARD_LANES)[number];

/** Which stages land in which lane. The union is exactly STAGES. */
export const LANE_STAGES: Record<BoardLane, readonly OpportunityStage[]> = {
  new: ["new", "assigned"],
  working: ["attempting", "contacted"],
  committed: ["interested", "appointment_booked", "appointment_completed"],
  won: ["sold"],
  parked: ["nurture"],
  closed: ["lost", "invalid", "dnc_suppressed", "exhausted", "duplicate", "disqualified"],
};

const LANE_BY_STAGE = new Map<string, BoardLane>(
  BOARD_LANES.flatMap((lane) => LANE_STAGES[lane].map((s) => [s as string, lane] as const)),
);

export function laneForStage(stage: OpportunityStage): BoardLane {
  return LANE_BY_STAGE.get(stage) ?? "closed";
}

/**
 * The stage a card takes when dropped on a lane. Null means the lane cannot be
 * a drop target on its own: "New" is where records BEGIN (you don't move one
 * back to untouched — that's a regress, and a regress needs an explicit stage),
 * and "Closed" holds six genuinely different endings, so dropping there has to
 * ask which one. Guessing "lost" when the rep meant "duplicate" writes a wrong
 * fact into an append-only log.
 */
export function laneEntryStage(lane: BoardLane): OpportunityStage | null {
  switch (lane) {
    case "working":
      return "attempting";
    case "committed":
      return "interested";
    case "won":
      return "sold";
    case "parked":
      return "nurture";
    default:
      return null;
  }
}

/** Where a card in `stage` may legally be dropped, per the stage machine. */
export function legalDropLanes(
  stage: OpportunityStage,
  actor: StageActor,
  opts?: { allowRegress?: boolean },
): BoardLane[] {
  return BOARD_LANES.filter((lane) => {
    if (lane === laneForStage(stage)) return false;
    const stages = lane === "closed" ? LANE_STAGES.closed : [laneEntryStage(lane)];
    // A lane is a legal target if ANY stage in it is reachable — "Closed" opens
    // a picker, so it is offered when at least one ending is permitted.
    return stages.some((to) => to != null && canTransition(stage, to, actor, opts).ok);
  });
}

export interface LaneCopy {
  /** Column heading. Industry-neutral by construction — no vocabulary needed. */
  label: string;
  /** What this lane contains, in the operator's terms. */
  blurb: string;
  /** Shown instead of cards when the lane is empty, stated as a fact. */
  empty: string;
}

/**
 * `appointmentNoun` is the only vocabulary this module needs; the rest of the
 * copy is deliberately generic sales language, because a lane heading that said
 * "homeowner" would be wrong for nine of the ten verticals.
 */
export function laneCopy(lane: BoardLane, appointmentNoun: string): LaneCopy {
  switch (lane) {
    case "new":
      return {
        label: "New",
        blurb: "Nobody has attempted these yet.",
        empty: "Nothing waiting — every record has been attempted at least once.",
      };
    case "working":
      return {
        label: "Working",
        blurb: "Attempted or reached, still in play.",
        empty: "Nothing in flight.",
      };
    case "committed":
      return {
        label: "Committed",
        blurb: `Interested, or holding a scheduled ${appointmentNoun}.`,
        empty: `No one is currently holding a ${appointmentNoun}.`,
      };
    case "won":
      return {
        label: "Won",
        blurb: "Closed won, still tracked through fulfillment.",
        empty: "Nothing won yet in this view.",
      };
    case "parked":
      return {
        label: "Parked",
        blurb: "Deliberately set aside with a review date.",
        empty: "Nothing parked.",
      };
    default:
      return {
        label: "Closed",
        blurb: "Lost, invalid, duplicate, exhausted, or suppressed.",
        empty: "Nothing closed in this view.",
      };
  }
}

/** Closing a record asserts a reason; these are the six it can be. */
export const CLOSE_REASONS: { stage: OpportunityStage; label: string; hint: string }[] = [
  { stage: "lost", label: "Lost", hint: "They said no." },
  { stage: "disqualified", label: "Disqualified", hint: "They do not qualify." },
  { stage: "invalid", label: "Bad data", hint: "Wrong number or not a real record." },
  { stage: "duplicate", label: "Duplicate", hint: "Already in the book under another record." },
  { stage: "exhausted", label: "Exhausted", hint: "Every attempt used, never reached." },
  {
    stage: "dnc_suppressed",
    label: "Do not contact",
    hint: "They asked us to stop. Also adds the number to the suppression list.",
  },
];

/** Every stage is in exactly one lane — asserted by the board test. */
export const ALL_STAGES_COVERED: readonly OpportunityStage[] = STAGES;
