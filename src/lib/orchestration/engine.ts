import "server-only";

import { dncKey, getDncDigits } from "@/lib/db/dnc";
import { proposeStepMessage } from "./propose-message";
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
  /** Steps held back by a frequency cap — waiting, not lost. */
  deferred: number;
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

/**
 * Whether a callback was SET or COMPLETED since this instance activated.
 *
 * These two facts were hardcoded false, which quietly made `callback_completed`
 * an inert stop rule — and that rule is the natural "we're done here" for the
 * promised-callback playbook, whose whole job is chasing an overdue callback.
 * With it inert, a rep who called the person back but did not reach them still
 * got escalated to managers an hour later for a breach they had already worked.
 *
 * Only queried when the playbook actually lists one of the two rules.
 */
async function callbackState(
  admin: ReturnType<typeof createAdminClient>,
  inst: InstanceRow,
  leadId: unknown,
  since: (v: unknown) => boolean,
  opts?: { needsCallbackState?: boolean },
): Promise<{ callbackSet: boolean; callbackCompleted: boolean }> {
  const out = { callbackSet: false, callbackCompleted: false };
  if (!opts?.needsCallbackState || !leadId) return out;
  try {
    const { data } = await admin
      .from("callbacks")
      .select("status, created_at, last_attempt_at")
      .eq("org_id", inst.org_id)
      .eq("lead_id", String(leadId))
      .limit(20);
    for (const cb of (data ?? []) as Record<string, unknown>[]) {
      const status = String(cb.status ?? "");
      if (status === "completed") {
        if (since(cb.last_attempt_at)) out.callbackCompleted = true;
      } else if (status !== "cancelled" && since(cb.created_at)) {
        out.callbackSet = true;
      }
    }
  } catch {
    /* keep both false — a read failure must not fake a stop condition */
  }
  return out;
}

/**
 * Has the customer answered since this run started?
 *
 * Reads the `messages` table directly rather than importing the messaging
 * layer. That is not fussiness: an architecture test forbids the engine from
 * reaching anything that can SEND, and the cheapest way to keep that true is
 * for the engine to know about a table rather than about a module.
 *
 * Only queried when the playbook actually lists the rule — the same discipline
 * as callbackState, so a playbook that does not care about replies pays
 * nothing for the fact that the feature exists.
 */
async function repliedSince(
  admin: ReturnType<typeof createAdminClient>,
  inst: InstanceRow,
  leadId: unknown,
  opts?: { needsReplied?: boolean },
): Promise<boolean> {
  if (!opts?.needsReplied || !leadId) return false;
  try {
    const { count: c } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", inst.org_id)
      .eq("lead_id", String(leadId))
      .eq("direction", "inbound")
      .gte("created_at", inst.started_at);
    return (c ?? 0) > 0;
  } catch {
    // A read failure must not fake a stop condition — the sequence continues
    // and the next tick tries again.
    return false;
  }
}

async function stopSnapshot(
  admin: ReturnType<typeof createAdminClient>,
  inst: InstanceRow,
  opts?: {
    maxAttempts?: number;
    needsCallbackState?: boolean;
    needsReplied?: boolean;
    suppressed?: boolean;
  },
): Promise<(StopSnapshot & { leadId: string | null; ownerId: string | null }) | null> {
  const { data: opp } = await admin
    .from("opportunities")
    .select(
      "lead_id, stage, op_status, owner_id, owner_assigned_at, first_contacted_at, last_touched_at, attempt_count",
    )
    .eq("id", inst.opportunity_id)
    .maybeSingle();
  if (!opp) return null;
  const capped = (opts?.maxAttempts ?? 0) > 0;
  const stage = String(opp.stage ?? "new");
  const since = Date.parse(inst.started_at);
  const touchedSince = (v: unknown) =>
    v != null && Number.isFinite(Date.parse(String(v))) && Date.parse(String(v)) >= since;
  return {
    leadId: opp.lead_id ? String(opp.lead_id) : null,
    ownerId: opp.owner_id ? String(opp.owner_id) : null,
    // Either the stage says so, or the org's suppression list does. The
    // second half is what makes an inbound STOP stop a running playbook.
    dncOrOptOut: stage === "dnc_suppressed" || opts?.suppressed === true,
    opportunityClosed: String(opp.op_status) === "closed",
    managerPause: String(opp.op_status) === "paused",
    contacted: touchedSince(opp.first_contacted_at),
    attempted: touchedSince(opp.last_touched_at),
    // Real now that inbound messages are persisted: someone answering is the
    // clearest possible signal to stop working a sequence at them.
    replied: await repliedSince(admin, inst, opp.lead_id, opts),
    // Complaints and service issues still have no source, so these two cannot
    // trip — and publishing refuses a playbook that names them.
    complaint: false,
    openIssue: false,
    ...(await callbackState(admin, inst, opp.lead_id, touchedSince, opts)),
    appointmentBooked: stage === "appointment_booked" || stage === "appointment_completed",
    sold: stage === "sold",
    // Real: ownership moving after the playbook started IS the reassignment
    // this rule exists to catch (stampOpportunitiesAssigned writes the stamp).
    reassigned: touchedSince(opp.owner_assigned_at),
    // Only paid for when a cap exists — otherwise the value is never read.
    attemptsSinceActivation: capped
      ? await attemptsSinceActivation(
          admin,
          inst,
          opp.lead_id ? String(opp.lead_id) : null,
        )
      : 0,
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

/**
 * Frequency caps (`caps.touchesPerDay` / `caps.touchesPer7Days`).
 *
 * These were declared in the grammar, validated on publish and set on a seed
 * template — and never read, so an operator who configured "at most one touch
 * a day" got no such limit. A cap that does nothing is worse than no cap,
 * because it is believed.
 *
 * A touch is a real contact attempt on the lead (call_records), not a
 * bookkeeping step — the cap protects the person on the other end, so it has
 * to count what actually reaches them, whoever placed it.
 *
 * Returns the instant the cap frees up, or null when the step may run now.
 * Being capped DEFERS the step rather than skipping it: "no more than one
 * today" means wait for tomorrow, not cancel the follow-up.
 */
async function capDeferUntil(
  admin: ReturnType<typeof createAdminClient>,
  inst: InstanceRow,
  leadId: string | null,
  caps: { touchesPerDay?: number; touchesPer7Days?: number } | undefined,
  now: Date,
): Promise<Date | null> {
  const perDay = Math.max(0, Math.round(Number(caps?.touchesPerDay) || 0));
  const perWeek = Math.max(0, Math.round(Number(caps?.touchesPer7Days) || 0));
  if ((!perDay && !perWeek) || !leadId) return null;
  try {
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    // BOTH channels. A cap protects the person on the other end, so it counts
    // what actually reached them regardless of how it got there. Counting only
    // calls meant a playbook could text someone and then immediately raise a
    // call task "within" a cap of one touch a day — two contacts, one counted.
    //
    // Only messages the carrier ACCEPTED count (provider_sid present): one the
    // gate blocked never reached anybody and must not spend their allowance.
    const [callsRes, msgsRes] = await Promise.all([
      admin
        .from("call_records")
        .select("started_at")
        .eq("org_id", inst.org_id)
        .eq("lead_id", leadId)
        .gte("started_at", weekAgo)
        .order("started_at", { ascending: true })
        .limit(200),
      admin
        .from("messages")
        .select("created_at")
        .eq("org_id", inst.org_id)
        .eq("lead_id", leadId)
        .eq("direction", "outbound")
        .not("provider_sid", "is", null)
        .gte("created_at", weekAgo)
        .order("created_at", { ascending: true })
        .limit(200),
    ]);
    const times = [
      ...((callsRes.data ?? []) as Record<string, unknown>[]).map((r) =>
        Date.parse(String(r.started_at)),
      ),
      ...((msgsRes.data ?? []) as Record<string, unknown>[]).map((r) =>
        Date.parse(String(r.created_at)),
      ),
    ]
      .filter((t) => Number.isFinite(t))
      // Merged from two sources, so re-sort: the per-source ordering says
      // nothing about the combined sequence, and the deferral maths below
      // depends on times[0] being the genuinely oldest touch in the window.
      .sort((a, b) => a - b);
    if (!times.length) return null;

    const dayAgo = now.getTime() - 86_400_000;
    const inDay = times.filter((t) => t >= dayAgo);
    let until: number | null = null;
    // The window clears one full period after the OLDEST touch inside it, so
    // the deferral is exact instead of a poll.
    if (perDay && inDay.length >= perDay) {
      until = Math.max(until ?? 0, inDay[0] + 86_400_000);
    }
    if (perWeek && times.length >= perWeek) {
      until = Math.max(until ?? 0, times[0] + 7 * 86_400_000);
    }
    return until ? new Date(until) : null;
  } catch {
    // Never invent a cap breach from a failed read — that would silently
    // stall a playbook.
    return null;
  }
}

/** Move to the next step, or finish when the playbook is out of steps. CAS on
 *  the current step so a racing tick loses instead of double-advancing. */
async function advanceOrComplete(
  admin: ReturnType<typeof createAdminClient>,
  inst: InstanceRow,
  stepCount: number,
  now: Date,
): Promise<void> {
  const nextIndex = inst.current_step + 1;
  if (nextIndex >= stepCount) {
    await endInstance(admin, inst, "completed");
    return;
  }
  await admin
    .from("playbook_instances")
    .update({ current_step: nextIndex, updated_at: now.toISOString() })
    .eq("id", inst.id)
    .eq("current_step", inst.current_step);
}

/**
 * Attempts made SINCE this instance activated.
 *
 * `opportunities.attempt_count` is the lead's LIFETIME total, so using it for
 * a playbook's maxAttempts cap compares the wrong two numbers: a follow-up
 * playbook capped at 4 would stop instantly on any lead already dialed four
 * times — precisely the leads it exists to work. Counted from call_records
 * since the instance started, and only when a cap is actually configured.
 */
async function attemptsSinceActivation(
  admin: ReturnType<typeof createAdminClient>,
  inst: InstanceRow,
  leadId: string | null,
): Promise<number> {
  if (!leadId) return 0;
  try {
    const { count: n, error } = await admin
      .from("call_records")
      .select("id", { count: "exact", head: true })
      .eq("org_id", inst.org_id)
      .eq("lead_id", leadId)
      .gte("started_at", inst.started_at);
    // Fails CLOSED, like the messaging caps. This is a per-playbook attempt
    // ceiling, and returning 0 on a failed count read as "no attempts spent" —
    // so the playbook would keep dialing straight past the maximum an operator
    // configured. Reporting the cap as spent pauses it instead.
    if (error) return Number.MAX_SAFE_INTEGER;
    return n ?? 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** One deterministic tick. Never throws; returns an operator-readable report. */
export async function orchestrationTick(now = new Date()): Promise<TickResult> {
  const out: TickResult = {
    skipped: null,
    woken: 0,
    executed: 0,
    deferred: 0,
    stopped: 0,
    failed: 0,
  };
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
      .select("id, settings, timezone")
      .in("id", orgIds);
    const orgEnabled = new Map(
      (orgs ?? []).map((o) => [
        String(o.id),
        mergeSettings(o.settings).orchestration.enabled,
      ]),
    );
    const orgTz = new Map(
      (orgs ?? []).map((o) => [String(o.id), String(o.timezone ?? "") || "America/Chicago"]),
    );
    // Suppression, batched. `dnc_or_opt_out` is ALWAYS enforced, so this is
    // needed for every instance — but it resolves to two reads per tick rather
    // than two per instance.
    //
    // Why it exists at all: addToDnc writes dnc_numbers and nothing else, while
    // the snapshot below derived opt-out purely from opportunities.stage. A
    // customer who texted STOP was therefore blocked from being DIALED while
    // every running playbook kept escalating them. Reading the suppression list
    // itself makes the rule hold for any opt-out path, including ones that
    // forget the stage transition.
    const oppIds = [...new Set(instances.map((i) => String(i.opportunity_id)))];
    const { data: oppLeads } = await admin
      .from("opportunities")
      .select("id, lead_id")
      .in("id", oppIds);
    const leadIdByOpp = new Map(
      ((oppLeads ?? []) as Record<string, unknown>[])
        .filter((o) => o.lead_id != null)
        .map((o) => [String(o.id), String(o.lead_id)]),
    );
    const leadIds = [...new Set(leadIdByOpp.values())];
    const phoneByLead = new Map<string, string>();
    if (leadIds.length) {
      const { data: leadRows } = await admin
        .from("leads")
        .select("id, phone")
        .in("id", leadIds);
      for (const l of (leadRows ?? []) as Record<string, unknown>[]) {
        phoneByLead.set(String(l.id), String(l.phone ?? ""));
      }
    }
    const dncByOrg = new Map<string, Set<string>>();
    for (const orgId of orgIds) dncByOrg.set(orgId, await getDncDigits(orgId));

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
        const rules = resolveStopRules(def);
        const leadPhone = phoneByLead.get(
          leadIdByOpp.get(String(inst.opportunity_id)) ?? "",
        );
        const suppressed =
          leadPhone != null &&
          Boolean(dncKey(leadPhone)) &&
          (dncByOrg.get(String(inst.org_id))?.has(dncKey(leadPhone)) ?? false);
        const snap = await stopSnapshot(admin, inst, {
          maxAttempts: def.stop?.maxAttempts,
          needsCallbackState:
            rules.has("callback_completed") || rules.has("callback_set"),
          needsReplied: rules.has("replied"),
          suppressed,
        });
        if (!snap) {
          await endInstance(admin, inst, "stopped", "opportunity_missing");
          out.stopped++;
          continue;
        }
        const tripped = firstTrippedStopRule(rules, snap, {
          maxAttempts: def.stop?.maxAttempts,
          stopOnReassign: def.stop?.stopOnReassign,
        });
        if (tripped) {
          await endInstance(admin, inst, "stopped", tripped);
          out.stopped++;
          continue;
        }

        // Frequency caps, before the gate. Deferring after the gate would
        // burn the step's execution row and skip it permanently.
        //
        // Applies to send_message too. Publishing a messaging playbook is
        // REFUSED unless caps.touchesPerDay is set — so gating only
        // create_work_item meant the one setting an author was forced to
        // provide had no effect on the one step it was demanded for. A cap
        // that cannot fire is worse than no cap: it reads as a protection.
        if (step.kind === "create_work_item" || step.kind === "send_message") {
          const deferUntil = await capDeferUntil(
            admin,
            inst,
            snap.leadId,
            def.caps,
            now,
          );
          if (deferUntil) {
            await admin
              .from("playbook_instances")
              .update({
                status: "waiting",
                wait_until: deferUntil.toISOString(),
                updated_at: now.toISOString(),
              })
              .eq("id", inst.id)
              .eq("current_step", inst.current_step);
            out.deferred++;
            continue;
          }
        }

        // Waits move the instance to 'waiting' — no execution row needed (the
        // wake pass is idempotent by construction).
        if (step.kind === "wait") {
          // `for.timezone` chooses whose clock a local-time wait follows.
          // It was accepted and ignored — every wait used the lead's zone —
          // and the fallback was a hardcoded America/Chicago rather than the
          // workspace's own, so "wait until 10:00" could mean 10:00 somewhere
          // nobody works.
          const wantsOrg =
            (step.for as { timezone?: string } | undefined)?.timezone === "org";
          const fallback = orgTz.get(String(inst.org_id)) ?? "America/Chicago";
          let tz = fallback;
          if (!wantsOrg) {
            const { data: lead } = await admin
              .from("opportunities")
              .select("lead_id, leads(timezone)")
              .eq("id", inst.opportunity_id)
              .maybeSingle();
            tz =
              String(
                (lead as { leads?: { timezone?: string } } | null)?.leads?.timezone ?? "",
              ) || fallback;
          }
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
          if (gateErr.code === "23505") {
            // This step already ran — another worker, or a tick that died
            // between the gate and the advance below. Do NOT re-run the
            // action, but DO move the instance on: leaving it parked here
            // means every future tick re-plans the same step, hits the same
            // conflict, and the instance never progresses again.
            await advanceOrComplete(admin, inst, steps.length, now);
          } else {
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
            // Both of these were omitted, and every consumer keys on them: a
            // task with no lead_id is invisible to the who-next ladder and the
            // pre-call brief, is never reserved when the rep claims the lead,
            // and is never completed when the disposition is filed. With no
            // owner_id it never appears in anyone's My Day either. A task
            // nobody can see is not follow-through.
            leadId: snap.leadId,
            ownerId: snap.ownerId,
            type: step.type,
            reason: step.reason,
            dedupeKey: `${inst.id}:${step.id}`,
            queue: step.queue ?? null,
            priority: step.priority ?? 0,
            dueAt: due,
            sourceKind: "playbook",
            sourceId: inst.playbook_id,
            automationEligible: false,
          });
        } else if (step.kind === "send_message") {
          // PROPOSE ONLY. This branch cannot send and, by construction, cannot
          // reach anything that can — see tests/messaging-architecture.test.ts,
          // which proves the transport is unreachable from this module through
          // any chain of imports. What lands here is a message row waiting for
          // a named human, and a task telling one it is waiting.
          //
          // The step then ADVANCES. The proposal happened; whether a human
          // approves it is their decision, recorded on the message row rather
          // than by parking the instance on a step it already completed.
          const proposed = await proposeStepMessage(admin, {
            inst,
            step,
            leadId: snap.leadId,
            ownerId: snap.ownerId,
            now,
          });
          if (proposed.workItemNeeded) {
            await createWorkItem({
              orgId: inst.org_id,
              opportunityId: inst.opportunity_id,
              leadId: snap.leadId,
              // Unowned on purpose: an approval is not the rep's job, and
              // leaving it unassigned puts it in the shared queue where
              // whoever is free can take it.
              ownerId: null,
              type: "review",
              reason: "approve_message",
              dedupeKey: `${inst.id}:${step.id}:review`,
              queue: "approvals",
              priority: 70,
              sourceKind: "playbook",
              sourceId: inst.playbook_id,
              automationEligible: false,
            });
          }
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
            // Without this the hot queue shows "Unknown contact" with no link,
            // and My Day can never promote the signal into who-next.
            lead_id: snap.leadId,
            type: `escalation:${step.reason}`,
            severity: 4,
            // WHO this rung is for. `queue` has no queue-membership model yet,
            // so it resolves to the supervisor audience rather than silently
            // behaving like an owner nudge.
            audience: step.to === "owner" ? "owner" : "managers",
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
        await advanceOrComplete(admin, inst, steps.length, now);
      } catch {
        count("orchestrate.instance_fail", 1, { orgId: String(inst.org_id) });
        out.failed++;
      }
    }
  } catch {
    out.skipped = "tick_error";
  } finally {
    // Heartbeat: proof the engine ran at all. In `finally` on purpose — the
    // body returns early on the two most common outcomes (globally paused,
    // and no instances to process), and those are exactly the ticks whose
    // silence would otherwise be indistinguishable from a cron that was never
    // scheduled. A healthy idle engine must still say it is alive.
    try {
      await admin
        .from("app_settings")
        .update({ orchestration_last_tick_at: now.toISOString() })
        .eq("id", "global");
    } catch {
      /* column absent (PART 38 not applied) — the health read says "unknown" */
    }
  }
  return out;
}
