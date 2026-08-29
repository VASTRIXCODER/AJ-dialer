import "server-only";

import {
  completeCallWorkItems,
  getOpenOpportunityByLead,
  stampOpportunityTouch,
  transitionOpportunityStage,
} from "@/lib/db/opportunities";
import { stageForLeadStatus, type OpportunityStage } from "./stage-machine";
import type { CallOutcome, LeadStatus } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// One-way sync: Phase 1 call write paths → the opportunity (P2.1 §6 of the
// design doc). Fire-and-forget from insertCallRecord / completeAIConversation
// AFTER routing — it must NEVER throw into a disposition save or a webhook,
// and it no-ops cleanly on environments that haven't applied PART 37.
// leads.status remains the reporting authority; this keeps the opportunity's
// clocks, counters, stage and work items honest alongside it.
// ─────────────────────────────────────────────────────────────────────────────

/** Which stage a filed call outcome argues for (forward-only; never sold). */
function stageForOutcome(outcome: CallOutcome | null): OpportunityStage | null {
  switch (outcome) {
    case "appointment_booked":
      return "appointment_booked";
    case "qualified":
      return "interested";
    case "callback_scheduled":
      return "contacted";
    case "not_interested":
      return "lost";
    case "bills_fine":
      return "nurture";
    case "do_not_call":
      return "dnc_suppressed";
    case "no_answer":
    case "voicemail":
    case "wrong_number":
      return "attempting";
    default:
      return null;
  }
}

export async function syncOpportunityAfterCall(input: {
  orgId: string | null | undefined;
  leadId: string | null | undefined;
  outcome: CallOutcome | null;
  connected: boolean;
  channel: "human" | "ai";
  actorId?: string | null;
  /** The lead's CURRENT status after routing, when the caller knows it. */
  leadStatus?: LeadStatus;
}): Promise<void> {
  try {
    if (!input.orgId || !input.leadId) return;
    const opp = await getOpenOpportunityByLead(input.orgId, input.leadId);
    if (!opp) return; // PART 37 not applied, or the lead predates the backfill

    await stampOpportunityTouch({
      opportunityId: opp.id,
      orgId: input.orgId,
      connected: input.connected,
    });

    // A connected call means "contacted" at minimum; the outcome may argue
    // further. Both go through the machine — forward-only, so a late replay
    // can't demote (canTransition refuses regressions for system actors).
    const target =
      stageForOutcome(input.outcome) ??
      (input.leadStatus ? stageForLeadStatus(input.leadStatus, Boolean(opp.ownerId)) : null) ??
      (input.connected ? "contacted" : "attempting");
    if (target !== opp.stage) {
      await transitionOpportunityStage({
        opportunityId: opp.id,
        orgId: input.orgId,
        from: opp.stage,
        to: target,
        actor: "system",
        actorId: input.actorId ?? null,
        reason: `call_${input.channel}:${input.outcome ?? "none"}`,
      });
    }

    // A filed disposition closes the loop on whatever call work item spawned
    // this dial. Skipped calls file nothing and complete nothing.
    if (input.outcome) {
      await completeCallWorkItems({
        orgId: input.orgId,
        leadId: input.leadId,
        completedBy: input.actorId ?? null,
        evidence: { outcome: input.outcome, channel: input.channel },
      });
    }
  } catch {
    /* bookkeeping must never take a call path down */
  }
}
