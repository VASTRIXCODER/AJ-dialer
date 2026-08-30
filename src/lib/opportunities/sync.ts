import "server-only";

import {
  completeCallWorkItems,
  getOpenOpportunityByLead,
  setOpportunityNextAction,
  stampOpportunityTouch,
  transitionOpportunityStage,
} from "@/lib/db/opportunities";
import { floatingToUtcIso } from "@/lib/appointments/time";
import { emitOrchestrationEvent } from "@/lib/orchestration/events";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { nextActionForOutcome } from "./next-action";
import { stageForLeadStatus, type OpportunityStage } from "./stage-machine";
import type { CallOutcome, LeadStatus } from "@/lib/types";
import { DEFAULT_TIMEZONE, storedOrgTimezone } from "../metrics/definitions";

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

// The org's timezone, cached briefly: the agreed callback/appointment times
// arrive as FLOATING wall clocks and next_action_due_at is a genuinely-UTC
// column (app_pipeline_leaks compares it against now()), so converting needs
// the zone. Cheap indexed read, and a stale-by-minutes zone is harmless.
const tzCache = new Map<string, { tz: string; at: number }>();
const TZ_TTL_MS = 300_000;

async function orgTimezoneFor(orgId: string): Promise<string> {
  const hit = tzCache.get(orgId);
  if (hit && Date.now() - hit.at < TZ_TTL_MS) return hit.tz;
  let tz = DEFAULT_TIMEZONE;
  if (isAdminConfigured()) {
    try {
      const { data } = await createAdminClient()
        .from("organizations")
        .select("timezone")
        .eq("id", orgId)
        .maybeSingle();
      // storedOrgTimezone, not a truthiness test: the column defaulted to
      // America/Los_Angeles, so `data.timezone` is truthy on ten of eleven
      // workspaces without anyone having chosen it.
      tz = storedOrgTimezone(data?.timezone as string | null) ?? DEFAULT_TIMEZONE;
    } catch {
      /* default zone is a fine fallback for a bookkeeping stamp */
    }
  }
  tzCache.set(orgId, { tz, at: Date.now() });
  return tz;
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
  /** Agreed callback time (floating iso, the callbacks convention), if any. */
  callbackAt?: string | null;
  /** Booked appointment time (floating iso), if any. */
  appointmentAt?: string | null;
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

    // P2.3: every disposition leaves an explicit "what happens next, when" —
    // callback/appointment times when they were agreed, deterministic
    // follow-up windows otherwise, cleared on closing outcomes.
    // The agreed times arrive FLOATING; next_action_due_at is compared against
    // now() by app_pipeline_leaks, so it must hold a real UTC instant. Mixing
    // the two conventions in one column made a 5pm promise read as overdue —
    // and a leak — from midday.
    const needsTz = Boolean(input.callbackAt || input.appointmentAt);
    const tz = needsTz ? await orgTimezoneFor(input.orgId) : "UTC";
    const nextAction = nextActionForOutcome(input.outcome, {
      callbackAt: floatingToUtcIso(input.callbackAt, tz),
      appointmentAt: floatingToUtcIso(input.appointmentAt, tz),
    });
    if (nextAction) {
      await setOpportunityNextAction({
        opportunityId: opp.id,
        orgId: input.orgId,
        action: nextAction === "clear" ? null : nextAction,
      });
    }

    // Orchestration: `call.completed` is the trigger behind no-answer
    // follow-up and friends. No-op unless the org opted into orchestration
    // and published a listener — the emitter checks both.
    await emitOrchestrationEvent({
      orgId: input.orgId,
      leadId: input.leadId,
      event: "call.completed",
      touch: {
        outcome: input.outcome,
        channel: input.channel === "ai" ? "ai_call" : "manual_call",
        direction: "outbound",
      },
    });
  } catch {
    /* bookkeeping must never take a call path down */
  }
}
