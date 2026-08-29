import "server-only";

import {
  canTransition,
  isClosingStage,
  isOpportunityStage,
  type OpportunityStage,
  type StageActor,
} from "@/lib/opportunities/stage-machine";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { count } from "@/lib/telemetry";

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity DB layer (PART 37). Everything here is deliberately defensive:
// the tables may not exist yet on an environment that hasn't applied PART 37,
// and NO Phase 1 write path may ever fail because of Phase 2 bookkeeping —
// every function catches, counts, and returns instead of throwing.
// Write-path ownership: stage/status/clock changes go through THIS module
// (event row first, then the derived row), mirroring the call-events rule.
// ─────────────────────────────────────────────────────────────────────────────

export interface OpportunityRow {
  id: string;
  orgId: string;
  leadId: string;
  stage: OpportunityStage;
  opStatus: "open" | "waiting" | "paused" | "closed";
  ownerId: string | null;
  attemptCount: number;
  contactCount: number;
  firstAttemptedAt: string | null;
  firstContactedAt: string | null;
  lastTouchedAt: string | null;
}

function mapRow(r: Record<string, unknown>): OpportunityRow {
  const stage = String(r.stage ?? "new");
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    leadId: String(r.lead_id),
    stage: (isOpportunityStage(stage) ? stage : "new") as OpportunityStage,
    opStatus: (String(r.op_status ?? "open") as OpportunityRow["opStatus"]),
    ownerId: r.owner_id ? String(r.owner_id) : null,
    attemptCount: Number(r.attempt_count ?? 0),
    contactCount: Number(r.contact_count ?? 0),
    firstAttemptedAt: r.first_attempted_at ? String(r.first_attempted_at) : null,
    firstContactedAt: r.first_contacted_at ? String(r.first_contacted_at) : null,
    lastTouchedAt: r.last_touched_at ? String(r.last_touched_at) : null,
  };
}

/** The lead's non-closed opportunity, if the org has one. */
export async function getOpenOpportunityByLead(
  orgId: string,
  leadId: string,
): Promise<OpportunityRow | null> {
  if (!isAdminConfigured() || !orgId || !leadId) return null;
  try {
    const { data } = await createAdminClient()
      .from("opportunities")
      .select(
        "id, org_id, lead_id, stage, op_status, owner_id, attempt_count, contact_count, first_attempted_at, first_contacted_at, last_touched_at",
      )
      .eq("org_id", orgId)
      .eq("lead_id", leadId)
      .neq("op_status", "closed")
      .maybeSingle();
    return data ? mapRow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Advance an opportunity's stage — event row FIRST, then the derived update.
 * Forward-only unless the actor is human with allowRegress. A refused
 * transition is not an error: the caller's evidence was simply older than the
 * record (exactly the call state machine's CAS philosophy).
 */
export async function transitionOpportunityStage(input: {
  opportunityId: string;
  orgId: string;
  from: OpportunityStage;
  to: OpportunityStage;
  actor: StageActor;
  actorId?: string | null;
  reason?: string;
  detail?: Record<string, unknown>;
  allowRegress?: boolean;
}): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const verdict = canTransition(input.from, input.to, input.actor, {
    allowRegress: input.allowRegress,
  });
  if (!verdict.ok) return false;
  try {
    const admin = createAdminClient();
    await admin.from("opportunity_events").insert({
      org_id: input.orgId,
      opportunity_id: input.opportunityId,
      type: "stage_changed",
      actor_kind: input.actor === "system_fulfillment" ? "system" : input.actor,
      actor_id: input.actorId ?? null,
      from_stage: input.from,
      to_stage: input.to,
      detail: { reason: input.reason ?? "", ...(input.detail ?? {}) },
    });
    // CAS on the FROM stage: a racing writer that already moved the row wins,
    // and this update becomes a no-op instead of a stomp.
    const patch: Record<string, unknown> = {
      stage: input.to,
      stage_entered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (isClosingStage(input.to)) {
      patch.op_status = "closed";
      patch.closed_at = new Date().toISOString();
      patch.close_reason = input.to;
    }
    await admin
      .from("opportunities")
      .update(patch)
      .eq("id", input.opportunityId)
      .eq("stage", input.from);
    return true;
  } catch {
    count("opportunity.transition_fail", 1, { orgId: input.orgId });
    return false;
  }
}

/** Stamp touch clocks + counters after a call (idempotent-ish: first_* only fill). */
export async function stampOpportunityTouch(input: {
  opportunityId: string;
  orgId: string;
  connected: boolean;
  at?: Date;
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    const iso = (input.at ?? new Date()).toISOString();
    // Read-modify-write on the two counters; the reconcile pass owns repair,
    // exactly like Phase 1 treats lead counters.
    const { data } = await admin
      .from("opportunities")
      .select("attempt_count, contact_count, first_attempted_at, first_contacted_at")
      .eq("id", input.opportunityId)
      .maybeSingle();
    if (!data) return;
    await admin
      .from("opportunities")
      .update({
        attempt_count: Number(data.attempt_count ?? 0) + 1,
        contact_count: Number(data.contact_count ?? 0) + (input.connected ? 1 : 0),
        first_attempted_at: data.first_attempted_at ?? iso,
        ...(input.connected ? { first_contacted_at: data.first_contacted_at ?? iso } : {}),
        last_touched_at: iso,
        updated_at: iso,
      })
      .eq("id", input.opportunityId);
  } catch {
    count("opportunity.touch_fail", 1, { orgId: input.orgId });
  }
}

/**
 * Create a work item, deduped: the partial unique on (org_id, dedupe_key)
 * absorbs replays while a live item exists. Returns the id (fresh or null on
 * dedupe/failure — callers must not care which).
 */
export async function createWorkItem(input: {
  orgId: string;
  opportunityId?: string | null;
  leadId?: string | null;
  type: string;
  reason: string;
  dedupeKey: string;
  ownerId?: string | null;
  queue?: string | null;
  priority?: number;
  dueAt?: Date | null;
  timezone?: string | null;
  sourceKind?: string;
  sourceId?: string;
  automationEligible?: boolean;
  requiresApproval?: boolean;
}): Promise<string | null> {
  if (!isAdminConfigured()) return null;
  try {
    const { data } = await createAdminClient()
      .from("work_items")
      .insert({
        org_id: input.orgId,
        opportunity_id: input.opportunityId ?? null,
        lead_id: input.leadId ?? null,
        type: input.type,
        reason: input.reason,
        dedupe_key: input.dedupeKey,
        owner_id: input.ownerId ?? null,
        queue: input.queue ?? null,
        priority: input.priority ?? 0,
        due_at: input.dueAt ? input.dueAt.toISOString() : null,
        timezone: input.timezone ?? null,
        source_kind: input.sourceKind ?? null,
        source_id: input.sourceId ?? null,
        automation_eligible: input.automationEligible ?? false,
        requires_approval: input.requiresApproval ?? false,
      })
      .select("id")
      .maybeSingle();
    return data?.id ? String(data.id) : null;
  } catch {
    // 23505 on the dedupe key is the expected replay path — silence is correct.
    return null;
  }
}

/**
 * Complete the opportunity's open call-type work items after a call filed —
 * the "every completed call completes or reschedules the originating work
 * item" rule (phase_two.md §8). Matched loosely by lead: v0 has no
 * work-item id threading through the dialer yet (P2.3 adds it).
 */
export async function completeCallWorkItems(input: {
  orgId: string;
  leadId: string;
  completedBy?: string | null;
  evidence?: Record<string, unknown>;
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    await createAdminClient()
      .from("work_items")
      .update({
        status: "completed",
        completed_by: input.completedBy ?? null,
        completed_at: new Date().toISOString(),
        completion_evidence: input.evidence ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", input.orgId)
      .eq("lead_id", input.leadId)
      .in("type", ["first_call", "follow_up_call", "callback", "hot_response"])
      .in("status", ["pending", "reserved", "in_progress", "waiting"]);
  } catch {
    count("work_item.complete_fail", 1, { orgId: input.orgId });
  }
}
