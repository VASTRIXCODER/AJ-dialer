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
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      stage: input.to,
      stage_entered_at: now,
      updated_at: now,
    };
    if (isClosingStage(input.to)) {
      patch.op_status = "closed";
      patch.closed_at = now;
      patch.close_reason = input.to;
    }

    // CAS on the FROM stage, and ASK whether it landed. A racing writer that
    // already moved the row wins and this matches zero rows — in which case we
    // must neither claim we moved it nor log that we did. The move therefore
    // comes FIRST: opportunity_events is append-only (a trigger refuses UPDATE
    // and DELETE), so an event written before a CAS that then lost is a
    // permanently wrong entry in the record's history with no way to retract
    // it. An unlogged move is recoverable; a fabricated one is not.
    const { data: moved } = await admin
      .from("opportunities")
      .update(patch)
      .eq("id", input.opportunityId)
      .eq("org_id", input.orgId)
      .eq("stage", input.from)
      .select("id");
    if (!Array.isArray(moved) || moved.length === 0) {
      count("opportunity.transition_lost_cas", 1, { orgId: input.orgId });
      return false;
    }

    // The stage HAS moved by here, so a failed event write must not report the
    // move as having failed — the caller asked "did the stage change?", and it
    // did. Logged separately so a silent history gap is still visible.
    const { error: logErr } = await admin.from("opportunity_events").insert({
      org_id: input.orgId,
      opportunity_id: input.opportunityId,
      type: "stage_changed",
      actor_kind: input.actor === "system_fulfillment" ? "system" : input.actor,
      actor_id: input.actorId ?? null,
      from_stage: input.from,
      to_stage: input.to,
      detail: { reason: input.reason ?? "", ...(input.detail ?? {}) },
    });
    if (logErr) count("opportunity.transition_unlogged", 1, { orgId: input.orgId });
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
 * INTAKE (§7): give every new lead an opportunity, with honest clocks.
 *
 * Insert-select over non-archived org leads that have no opportunity yet —
 * `first_received_at` comes from the LEAD's created_at (accurate however late
 * this runs), `eligible_at` stamps only when the lead is actually workable
 * (dialable status + plausible phone). Bounded and idempotent: the fast path
 * calls it right after an import chunk lands; the reconcile cron is the
 * safety net for any intake path that forgets. Returns the created pairs so
 * a caller can emit `lead.received` for a bounded few.
 */
export async function ensureOpportunitiesForNewLeads(
  limit = 2000,
): Promise<{ opportunityId: string; leadId: string; orgId: string }[]> {
  if (!isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    // Keyset-scan RECENT leads (30-day window, newest first) and collect the
    // ones missing an opportunity. The window is honest: history was covered
    // by the PART 37 backfill, so "new lead without an opportunity" is by
    // definition recent. Keyset paging (not a fixed head window) is the part
    // that matters — a 5k import would otherwise hide rows 2001+ behind a
    // window full of already-covered leads forever.
    const windowStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
    type LeadRow = Record<string, unknown>;
    const missing: LeadRow[] = [];
    let cursor: { createdAt: string; id: string } | null = null;
    for (let page = 0; page < 10 && missing.length < limit; page++) {
      let q = admin
        .from("leads")
        .select(
          "id, org_id, status, assigned_rep_id, owner_id, campaign_id, created_at, last_attempt_at, attempt_count, phone",
        )
        .is("archived_at", null)
        .not("org_id", "is", null)
        .gte("created_at", windowStart)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1000);
      if (cursor) {
        // Strictly older than the last row we saw (created_at desc keyset;
        // the id tiebreak rides the or() for equal timestamps).
        q = q.or(
          `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
        );
      }
      const { data: pageRows } = await q;
      const rows = (pageRows ?? []) as LeadRow[];
      if (!rows.length) break;
      const last = rows[rows.length - 1];
      cursor = { createdAt: String(last.created_at), id: String(last.id) };

      const ids = rows.map((l) => String(l.id));
      const covered = new Set<string>();
      for (let i = 0; i < ids.length; i += 500) {
        const { data: have } = await admin
          .from("opportunities")
          .select("lead_id")
          .in("lead_id", ids.slice(i, i + 500));
        for (const r of have ?? []) covered.add(String(r.lead_id));
      }
      for (const l of rows) {
        if (!covered.has(String(l.id))) missing.push(l);
        if (missing.length >= limit) break;
      }
      if (rows.length < 1000) break; // window exhausted
    }
    if (!missing.length) return [];
    const DIALABLE = new Set(["new", "no_answer", "callback"]);
    const rows = missing.map((l) => {
        const status = String(l.status ?? "new");
        const assigned = l.assigned_rep_id != null && String(l.assigned_rep_id) !== "";
        const stage =
          status === "new"
            ? assigned
              ? "assigned"
              : "new"
            : status === "no_answer"
              ? "attempting"
              : status === "contacted" || status === "callback"
                ? "contacted"
                : status === "qualified"
                  ? "interested"
                  : status === "appointment"
                    ? "appointment_booked"
                    : status === "bills_fine"
                      ? "nurture"
                      : status === "not_interested"
                        ? "lost"
                        : status === "dnc"
                          ? "dnc_suppressed"
                          : "new";
        const phoneOk = String(l.phone ?? "").replace(/\D/g, "").length >= 10;
        const created = String(l.created_at ?? new Date().toISOString());
        return {
          org_id: l.org_id,
          lead_id: l.id,
          stage,
          op_status: status === "not_interested" || status === "dnc" ? "closed" : "open",
          owner_id:
            assigned && /^[0-9a-f-]{36}$/i.test(String(l.assigned_rep_id))
              ? String(l.assigned_rep_id)
              : (l.owner_id ?? null),
          first_received_at: created,
          eligible_at: DIALABLE.has(status) && phoneOk ? created : null,
          first_attempted_at: l.last_attempt_at ?? null,
          last_touched_at: l.last_attempt_at ?? null,
          attempt_count: Number(l.attempt_count ?? 0),
          campaign_id: l.campaign_id ?? null,
          source: "intake",
          backfilled: false,
          created_at: created,
        };
      });
    if (!rows.length) return [];
    // Plain INSERT: the rows were pre-checked missing, so a conflict only
    // means another worker won a race in the tiny window since — the partial
    // unique can't be named in an upsert onConflict, and a dropped batch is
    // simply re-found by the next pass. Batches shrink the blast radius.
    const out: { opportunityId: string; leadId: string; orgId: string }[] = [];
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await admin
        .from("opportunities")
        .insert(rows.slice(i, i + 200))
        .select("id, lead_id, org_id");
      if (error) continue; // racer won — next pass re-checks
      for (const r of data ?? []) {
        out.push({
          opportunityId: String(r.id),
          leadId: String(r.lead_id),
          orgId: String(r.org_id),
        });
      }
    }
    return out;
  } catch {
    count("opportunity.intake_fail", 1, {});
    return [];
  }
}

/**
 * Assignment hook (§7): stamp ownership + the assigned stage the moment an
 * allocation lands. Bulk, idempotent-ish (first_assigned_at only fills), and
 * never throws into the allocation path.
 */
export async function stampOpportunitiesAssigned(input: {
  orgId: string;
  leadIds: string[];
  ownerId: string;
  reason?: string;
}): Promise<void> {
  if (!isAdminConfigured() || !input.leadIds.length) return;
  try {
    const admin = createAdminClient();
    const iso = new Date().toISOString();
    for (let i = 0; i < input.leadIds.length; i += 500) {
      await admin
        .from("opportunities")
        .update({
          owner_id: input.ownerId,
          owner_assigned_at: iso,
          assignment_reason: input.reason ?? "assignment",
          updated_at: iso,
        })
        .eq("org_id", input.orgId)
        .in("lead_id", input.leadIds.slice(i, i + 500))
        .neq("op_status", "closed");
      await admin
        .from("opportunities")
        .update({ first_assigned_at: iso, stage: "assigned", stage_entered_at: iso })
        .eq("org_id", input.orgId)
        .in("lead_id", input.leadIds.slice(i, i + 500))
        .eq("stage", "new")
        .is("first_assigned_at", null);
    }
  } catch {
    count("opportunity.assign_stamp_fail", 1, { orgId: input.orgId });
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
 * Close every open opportunity carrying this number, because the person asked
 * us to stop.
 *
 * `addToDnc` only writes the suppression list, which stops future DIALS — the
 * dial paths scrub against it. It does not touch the opportunity, and a running
 * playbook reads `opportunities.stage`. So before this existed, a customer who
 * texted STOP was blocked from being called while every live playbook kept
 * escalating them and kept creating call tasks about them.
 *
 * Suppresses ALL matching leads, not the first: a number legitimately appears
 * on several rows in an imported book, and stopping one of them is not stopping.
 * Never throws — an opt-out must not fail because of bookkeeping.
 */
export async function suppressOpportunitiesForPhone(input: {
  orgId: string;
  phone: string;
  reason?: string;
}): Promise<number> {
  if (!isAdminConfigured() || !input.orgId) return 0;
  const digits = String(input.phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return 0;
  try {
    const admin = createAdminClient();
    // ilike is a coarse prefilter; the exact last-10 comparison happens here so
    // "5551234567" can't match "19995551234567".
    const { data: leadRows, error: leadsErr } = await admin
      .from("leads")
      .select("id, phone")
      .eq("org_id", input.orgId)
      .ilike("phone", `%${digits}%`)
      .limit(50);
    // Reached from the inbound-STOP path. Returning 0 made "the read failed"
    // identical to "they had no open opportunities", so a customer who had just
    // said stop kept generating escalations and call tasks from a running
    // playbook. The caller wraps this, so a throw is caught and — unlike a 0 —
    // is distinguishable from success.
    if (leadsErr) {
      throw new Error("Could not read this contact's leads to suppress their playbooks");
    }
    const leadIds = ((leadRows ?? []) as Record<string, unknown>[])
      .filter(
        (l) => String(l.phone ?? "").replace(/\D/g, "").slice(-10) === digits,
      )
      .map((l) => String(l.id));
    if (!leadIds.length) return 0;

    const { data: opps, error: oppsErr } = await admin
      .from("opportunities")
      .select("id, stage")
      .eq("org_id", input.orgId)
      .in("lead_id", leadIds)
      .neq("op_status", "closed");
    if (oppsErr) {
      throw new Error("Could not read this contact's opportunities to suppress them");
    }

    let closed = 0;
    for (const o of (opps ?? []) as Record<string, unknown>[]) {
      const from = String(o.stage ?? "new");
      if (from === "dnc_suppressed") continue;
      const ok = await transitionOpportunityStage({
        opportunityId: String(o.id),
        orgId: input.orgId,
        from: from as OpportunityStage,
        to: "dnc_suppressed",
        actor: "system",
        reason: input.reason ?? "opt_out",
      });
      if (ok) closed += 1;
    }
    return closed;
  } catch {
    count("opportunity.suppress_fail", 1, { orgId: input.orgId });
    return 0;
  }
}

/** The work-item kinds a phone call satisfies. */
export const CALL_WORK_KINDS = [
  "first_call",
  "follow_up_call",
  "callback",
  "hot_response",
] as const;

/**
 * Set (or clear) the opportunity's explicit next action — the P2.3 "nothing
 * sits in limbo" stamp. Setting is guarded to OPEN opportunities (a very late
 * replay must not decorate a closed row); clearing is unguarded, so a closing
 * outcome leaves the row clean either way.
 */
export async function setOpportunityNextAction(input: {
  opportunityId: string;
  orgId: string;
  action: { kind: string; dueAt: string | null } | null;
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    let q = admin
      .from("opportunities")
      .update({
        next_action_kind: input.action?.kind ?? null,
        next_action_due_at: input.action?.dueAt ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.opportunityId)
      .eq("org_id", input.orgId);
    if (input.action) q = q.neq("op_status", "closed");
    await q;
  } catch {
    count("opportunity.next_action_fail", 1, { orgId: input.orgId });
  }
}

/**
 * P2.3 threading, claim side: when the dialer claims leads, the call work
 * items behind them get reserved for the SAME rep — so two reps working
 * overlapping queues can't both "own" the follow-up, and the disposition that
 * lands completes the item that was actually being worked. TTL-stamped, never
 * renewed on heartbeat by design: an expired reservation is simply
 * re-reservable by the next claim, and completion never depends on holding it.
 * Fire-and-forget — a missing PART 37 must not slow a claim down.
 */
export async function reserveCallWorkItems(input: {
  orgId: string;
  leadIds: string[];
  repId: string;
  ttlSeconds: number;
}): Promise<void> {
  if (!isAdminConfigured() || !input.leadIds.length) return;
  try {
    const nowIso = new Date().toISOString();
    const until = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    await createAdminClient()
      .from("work_items")
      .update({
        status: "reserved",
        reserved_by: input.repId,
        reserved_until: until,
        updated_at: nowIso,
      })
      .eq("org_id", input.orgId)
      .in("lead_id", input.leadIds.slice(0, 200))
      .in("type", [...CALL_WORK_KINDS])
      // Never take an item explicitly assigned to someone else — the same rule
      // app_claim_work_items enforces (owner_id is null or the claimant).
      .or(`owner_id.is.null,owner_id.eq.${input.repId}`)
      // Reservable: pending, or a reservation somebody let lapse.
      .or(`status.eq.pending,and(status.eq.reserved,reserved_until.lt.${nowIso})`);
  } catch {
    count("work_item.reserve_fail", 1, { orgId: input.orgId });
  }
}

/** Release THIS rep's work-item reservations (skip / session end). */
export async function releaseCallWorkItemsForRep(input: {
  orgId: string;
  repId: string;
  leadIds?: string[];
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    let q = createAdminClient()
      .from("work_items")
      .update({
        status: "pending",
        reserved_by: null,
        reserved_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", input.orgId)
      .eq("reserved_by", input.repId)
      .eq("status", "reserved");
    if (input.leadIds?.length) q = q.in("lead_id", input.leadIds.slice(0, 200));
    await q;
  } catch {
    count("work_item.release_fail", 1, { orgId: input.orgId });
  }
}

/**
 * Complete the opportunity's open call-type work items after a call filed —
 * the "every completed call completes or reschedules the originating work
 * item" rule (phase_two.md §8). Matched by lead + call kind; with P2.3
 * claim-side reservation, the reserved item IS the lead's item, so this
 * closes exactly the work that was being dialed.
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
      .in("type", [...CALL_WORK_KINDS])
      .in("status", ["pending", "reserved", "in_progress", "waiting"]);
  } catch {
    count("work_item.complete_fail", 1, { orgId: input.orgId });
  }
}
