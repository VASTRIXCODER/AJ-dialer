import "server-only";

import { createWorkItem } from "@/lib/db/opportunities";
import { mergeSettings } from "@/lib/org/settings";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { count } from "@/lib/telemetry";
import {
  resolveStopRules,
  type PlaybookDefinition,
  type Step,
} from "./definition";
import { firstTrippedStopRule, idempotencyKeyFor, waitUntil, type StopSnapshot } from "./plan";

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration engine v0 — the deterministic tick behind /api/cron/orchestrate.
//
// SCOPE (honest): v0 processes EXISTING playbook instances — wake expired
// waits, evaluate stop rules, execute due steps from the v0 allow-list
// (create_work_item / set_next_action / escalate / stop / wait). Instance
// ACTIVATION (event emitters, sweeps, the condition compiler) lands with
// P2.2/P2.3; until then this engine idles at zero instances, by design.
//
// Safety order per tick: kill switches → wake → per-instance: stop rules →
// idempotency-gated execution. Exactly-once = the UNIQUE insert into
// playbook_executions BEFORE the action runs; a retried tick that re-plans the
// same step hits the conflict and does nothing.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_INSTANCES_PER_TICK = 100;

interface TickResult {
  skipped: string | null;
  woken: number;
  executed: number;
  stopped: number;
  failed: number;
}

interface InstanceRow {
  id: string;
  org_id: string;
  playbook_id: string;
  playbook_version: number;
  opportunity_id: string;
  status: string;
  current_step: number;
  started_at: string;
}

async function stopSnapshot(
  admin: ReturnType<typeof createAdminClient>,
  inst: InstanceRow,
): Promise<StopSnapshot | null> {
  const { data: opp } = await admin
    .from("opportunities")
    .select(
      "stage, op_status, owner_id, first_contacted_at, last_touched_at, attempt_count",
    )
    .eq("id", inst.opportunity_id)
    .maybeSingle();
  if (!opp) return null;
  const stage = String(opp.stage ?? "new");
  const since = Date.parse(inst.started_at);
  const touchedSince = (v: unknown) =>
    v != null && Number.isFinite(Date.parse(String(v))) && Date.parse(String(v)) >= since;
  return {
    dncOrOptOut: stage === "dnc_suppressed",
    opportunityClosed: String(opp.op_status) === "closed",
    managerPause: String(opp.op_status) === "paused",
    contacted: touchedSince(opp.first_contacted_at),
    attempted: touchedSince(opp.last_touched_at),
    // v0 has no reply/complaint/issue emitters yet — these rules simply can't
    // trip until their workstreams land (documented in the contracts doc).
    replied: false,
    complaint: false,
    openIssue: false,
    callbackSet: false,
    callbackCompleted: false,
    appointmentBooked: stage === "appointment_booked" || stage === "appointment_completed",
    sold: stage === "sold",
    reassigned: false,
    attemptsSinceActivation: Number(opp.attempt_count ?? 0),
  };
}

async function endInstance(
  admin: ReturnType<typeof createAdminClient>,
  inst: InstanceRow,
  status: "completed" | "stopped" | "failed",
  reason?: string,
): Promise<void> {
  await admin
    .from("playbook_instances")
    .update({
      status,
      stopped_reason: reason ?? null,
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", inst.id)
    .in("status", ["active", "waiting"]);
}

/** One deterministic tick. Never throws; returns an operator-readable report. */
export async function orchestrationTick(now = new Date()): Promise<TickResult> {
  const out: TickResult = { skipped: null, woken: 0, executed: 0, stopped: 0, failed: 0 };
  if (!isAdminConfigured()) {
    out.skipped = "no database";
    return out;
  }
  const admin = createAdminClient();

  try {
    // Kill switch 1 — global (superadmin).
    const { data: app } = await admin
      .from("app_settings")
      .select("orchestration_paused")
      .eq("id", "global")
      .maybeSingle();
    if (app?.orchestration_paused === true) {
      out.skipped = "orchestration_paused (global)";
      return out;
    }

    // Wake expired waits (cheap set-based update).
    const { data: wokenRows } = await admin
      .from("playbook_instances")
      .update({ status: "active", wait_until: null, updated_at: now.toISOString() })
      .eq("status", "waiting")
      .lte("wait_until", now.toISOString())
      .select("id");
    out.woken = wokenRows?.length ?? 0;

    // Due instances, oldest first, bounded per tick.
    const { data: instances } = await admin
      .from("playbook_instances")
      .select(
        "id, org_id, playbook_id, playbook_version, opportunity_id, status, current_step, started_at",
      )
      .eq("status", "active")
      .order("updated_at", { ascending: true })
      .limit(MAX_INSTANCES_PER_TICK);
    if (!instances?.length) return out;

    // Kill switch 2 — org (`settings.orchestration.enabled`, default OFF) and
    // kill switch 3 — playbook paused. One read per distinct id.
    const orgIds = [...new Set(instances.map((i) => String(i.org_id)))];
    const { data: orgs } = await admin
      .from("organizations")
      .select("id, settings")
      .in("id", orgIds);
    const orgEnabled = new Map(
      (orgs ?? []).map((o) => [
        String(o.id),
        mergeSettings(o.settings).orchestration.enabled,
      ]),
    );
    const pbIds = [...new Set(instances.map((i) => String(i.playbook_id)))];
    const { data: pbs } = await admin
      .from("playbooks")
      .select("id, status, definition")
      .in("id", pbIds);
    const playbooks = new Map(
      (pbs ?? []).map((p) => [
        String(p.id),
        { status: String(p.status), definition: p.definition as PlaybookDefinition },
      ]),
    );

    for (const raw of instances as InstanceRow[]) {
      const inst = raw;
      try {
        if (orgEnabled.get(String(inst.org_id)) !== true) continue;
        const pb = playbooks.get(String(inst.playbook_id));
        if (!pb || pb.status === "paused") continue;
        if (pb.status === "retired") {
          await endInstance(admin, inst, "stopped", "retired");
          out.stopped++;
          continue;
        }

        const def = pb.definition;
        const steps: Step[] = Array.isArray(def?.steps) ? def.steps : [];
        const step = steps[inst.current_step];
        if (!step) {
          await endInstance(admin, inst, "completed");
          continue;
        }

        // Kill switch 4 — stop rules, before EVERY action.
        const snap = await stopSnapshot(admin, inst);
        if (!snap) {
          await endInstance(admin, inst, "stopped", "opportunity_missing");
          out.stopped++;
          continue;
        }
        const tripped = firstTrippedStopRule(resolveStopRules(def), snap, {
          maxAttempts: def.stop?.maxAttempts,
          stopOnReassign: def.stop?.stopOnReassign,
        });
        if (tripped) {
          await endInstance(admin, inst, "stopped", tripped);
          out.stopped++;
          continue;
        }

        // Waits move the instance to 'waiting' — no execution row needed (the
        // wake pass is idempotent by construction).
        if (step.kind === "wait") {
          const { data: lead } = await admin
            .from("opportunities")
            .select("lead_id, leads(timezone)")
            .eq("id", inst.opportunity_id)
            .maybeSingle();
          const tz =
            String(
              (lead as { leads?: { timezone?: string } } | null)?.leads?.timezone ?? "",
            ) || "America/Chicago";
          await admin
            .from("playbook_instances")
            .update({
              status: "waiting",
              wait_until: waitUntil(step, now, tz).toISOString(),
              current_step: inst.current_step + 1,
              updated_at: now.toISOString(),
            })
            .eq("id", inst.id)
            .eq("current_step", inst.current_step); // CAS: a racing tick loses
          continue;
        }

        // Exactly-once gate: the execution row FIRST. scheduled time = the
        // instance's updated_at boundary is not reproducible, so v0 uses the
        // step index epoch — instance:step:vN — which is retry-stable and
        // unique per step visit (linear playbooks visit a step once).
        const idem = idempotencyKeyFor(inst.id, step.id, `v${inst.playbook_version}`);
        const { error: gateErr } = await admin.from("playbook_executions").insert({
          org_id: inst.org_id,
          instance_id: inst.id,
          step_index: inst.current_step,
          action_kind: step.kind,
          idempotency_key: idem,
          status: "succeeded",
          detail: { stepId: step.id },
        });
        if (gateErr) {
          // 23505 = another worker already executed this step. Anything else:
          // count it and leave the instance for the next tick.
          if (gateErr.code !== "23505") {
            count("orchestrate.gate_fail", 1, { orgId: inst.org_id });
            out.failed++;
          }
          continue;
        }

        // The action itself (v0 allow-list).
        if (step.kind === "create_work_item") {
          const due =
            step.dueInMinutes != null
              ? new Date(now.getTime() + Math.max(0, step.dueInMinutes) * 60_000)
              : null;
          await createWorkItem({
            orgId: inst.org_id,
            opportunityId: inst.opportunity_id,
            type: step.type,
            reason: step.reason,
            dedupeKey: `${inst.id}:${step.id}`,
            queue: step.queue ?? null,
            priority: step.priority ?? 0,
            dueAt: due,
            sourceKind: "playbook",
            sourceId: inst.playbook_id,
            automationEligible: false,
            requiresApproval: step.requiresApproval ?? false,
          });
        } else if (step.kind === "set_next_action") {
          const mins =
            (step.next.dueInMinutes ?? 0) + (step.next.dueInDays ?? 0) * 24 * 60;
          await admin
            .from("opportunities")
            .update({
              next_action_kind: step.next.kind,
              next_action_due_at: new Date(now.getTime() + mins * 60_000).toISOString(),
              updated_at: now.toISOString(),
            })
            .eq("id", inst.opportunity_id);
        } else if (step.kind === "escalate") {
          // Internal escalation only — never a customer contact (contract §4).
          // v0 lands it as a deduped SIGNAL (the hot-queue surface will render
          // these in P2.6); email/notification-outbox delivery joins when the
          // P2.2 templates exist — the outbox's payloads are email-shaped and
          // trigger-fed today, so writing raw rows there would dead-letter.
          await admin.from("signals").insert({
            org_id: inst.org_id,
            opportunity_id: inst.opportunity_id,
            type: `escalation:${step.reason}`,
            severity: 4,
            evidence: {
              to: step.to,
              playbookId: inst.playbook_id,
              stepId: step.id,
            },
            source_kind: "playbook",
            source_id: inst.playbook_id,
            dedupe_key: `${inst.id}:${step.id}`,
          });
        } else if (step.kind === "stop") {
          await endInstance(admin, inst, "stopped", step.reason ?? "stop_step");
          out.stopped++;
          out.executed++;
          continue;
        }

        out.executed++;
        const nextIndex = inst.current_step + 1;
        if (nextIndex >= steps.length) {
          await endInstance(admin, inst, "completed");
        } else {
          await admin
            .from("playbook_instances")
            .update({ current_step: nextIndex, updated_at: now.toISOString() })
            .eq("id", inst.id)
            .eq("current_step", inst.current_step);
        }
      } catch {
        count("orchestrate.instance_fail", 1, { orgId: String(inst.org_id) });
        out.failed++;
      }
    }
  } catch {
    out.skipped = "tick_error";
  }
  return out;
}
