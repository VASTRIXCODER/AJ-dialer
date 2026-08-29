import "server-only";

import {
  ensureOpportunitiesForNewLeads,
  getOpenOpportunityByLead,
} from "@/lib/db/opportunities";
import { floatingMinutesBetween } from "@/lib/appointments/time";
import { zonedFloatingNow } from "@/lib/dialer/schedule";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { count } from "@/lib/telemetry";
import { evaluateConditions, type ConditionContext } from "./conditions";
import {
  TRIGGER_EVENTS,
  type PlaybookDefinition,
} from "./definition";

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration event emitters (P2.2) — the activation path the engine v0
// deliberately shipped without. `emitOrchestrationEvent` is called
// fire-and-forget from canonical write paths (lead intake, the call sync
// hook, assignment) and ACTIVATES playbook instances:
//
//   published playbook whose trigger.event matches
//     → trigger.filter over the touch context
//     → eligibility over the opportunity + lead snapshot
//     → reentry policy (default: one activation ever)
//     → INSERT playbook_instances (the partial-unique absorbs races/replays)
//
// Safety: org kill switch checked FIRST (settings.orchestration.enabled,
// default OFF — emitters are no-ops everywhere until an org opts in); never
// throws into a caller; bounded work per emit (one org, one lead, its
// published playbooks).
// ─────────────────────────────────────────────────────────────────────────────

export type OrchestrationEvent = (typeof TRIGGER_EVENTS)[number];

export interface EmitInput {
  orgId: string | null | undefined;
  leadId: string | null | undefined;
  event: OrchestrationEvent;
  /** The touch that fired the event (call.completed) — trigger-filter fodder. */
  touch?: Record<string, unknown>;
  /** Skip the org-enabled read when the caller already knows (the tick). */
  orgEnabledHint?: boolean;
}

/** Published, event-triggered playbooks for an org (one bounded read). */
async function publishedPlaybooksFor(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  event: OrchestrationEvent,
): Promise<{ id: string; version: number; definition: PlaybookDefinition }[]> {
  const { data } = await admin
    .from("playbooks")
    .select("id, version, definition")
    .eq("org_id", orgId)
    .eq("status", "published")
    .limit(50);
  return ((data ?? []) as { id: string; version: number; definition: PlaybookDefinition }[])
    .filter((p) => {
      const t = p.definition?.trigger;
      return t?.kind === "event" && t.event === event;
    });
}

async function orgOrchestrationEnabled(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<boolean> {
  return (await orgOrchestrationConfig(admin, orgId)).enabled;
}

/** Whether the org runs playbooks, and the zone its promises are written in. */
async function orgOrchestrationConfig(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<{ enabled: boolean; timezone: string }> {
  try {
    const { data } = await admin
      .from("organizations")
      .select("settings, timezone")
      .eq("id", orgId)
      .maybeSingle();
    const s = (data?.settings ?? {}) as { orchestration?: { enabled?: boolean } };
    return {
      enabled: s.orchestration?.enabled === true,
      timezone: String(data?.timezone ?? "") || "America/Chicago",
    };
  } catch {
    return { enabled: false, timezone: "America/Chicago" };
  }
}

/**
 * May this playbook activate again for this opportunity? Reentry default:
 * never after a completed/stopped run; `reentry.allow` + cooldownHours opens
 * it back up. An ACTIVE instance always blocks (the partial unique enforces
 * it too — this check just avoids burning an insert on the common case).
 */
async function reentryAllows(
  admin: ReturnType<typeof createAdminClient>,
  playbookId: string,
  opportunityId: string,
  def: PlaybookDefinition,
): Promise<boolean> {
  const { data } = await admin
    .from("playbook_instances")
    .select("status, ended_at")
    .eq("playbook_id", playbookId)
    .eq("opportunity_id", opportunityId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return true;
  if (data.status === "active" || data.status === "waiting") return false;
  if (!def.reentry?.allow) return false;
  const cooldownH = Math.max(0, Number(def.reentry.cooldownHours) || 0);
  if (cooldownH === 0) return true;
  const endedAt = data.ended_at ? Date.parse(String(data.ended_at)) : NaN;
  return !Number.isFinite(endedAt) || Date.now() - endedAt >= cooldownH * 3_600_000;
}

/** Assemble the condition snapshot for one opportunity + its lead. */
export async function conditionContextFor(
  admin: ReturnType<typeof createAdminClient>,
  opportunityId: string,
  leadId: string | null,
  touch?: Record<string, unknown>,
): Promise<ConditionContext> {
  const [{ data: opp }, { data: lead }] = await Promise.all([
    admin
      .from("opportunities")
      .select(
        "stage, op_status, priority, owner_id, campaign_id, source, attempt_count, contact_count, next_action_due_at, last_touched_at, hot_until, created_at",
      )
      .eq("id", opportunityId)
      .maybeSingle(),
    leadId
      ? admin
          .from("leads")
          .select(
            "status, state, city, zip, lead_group, timezone, campaign_id, attempt_count, last_contacted_at, created_at, phone",
          )
          .eq("id", leadId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const leadRow = (lead ?? null) as Record<string, unknown> | null;
  return {
    opportunity: (opp ?? null) as Record<string, unknown> | null,
    lead: leadRow
      ? {
          ...leadRow,
          // The grammar's `lead.dnc` reads the status (number-level DNC is
          // enforced at dial time regardless — this key is for eligibility).
          dnc: leadRow.status === "dnc",
          phone_valid:
            String(leadRow.phone ?? "").replace(/\D/g, "").length >= 10,
        }
      : null,
    touch: touch ?? null,
  };
}

/**
 * Lead intake processor (§7): make sure every new lead has an opportunity
 * (accurate clocks), then emit `lead.received` for a bounded few — per-lead
 * emission over a 5k import would mean thousands of inline evaluations, so
 * bulk activation beyond the bound waits for the sweep path and is counted,
 * never silently dropped. Fire-and-forget from the import route; the
 * reconcile cron is the safety net for any intake path that forgets.
 */
export async function processLeadIntake(emitCap = 50): Promise<number> {
  try {
    const created = await ensureOpportunitiesForNewLeads();
    for (const c of created.slice(0, emitCap)) {
      await emitOrchestrationEvent({
        orgId: c.orgId,
        leadId: c.leadId,
        event: "lead.received",
      });
    }
    if (created.length > emitCap) {
      count("orchestrate.emit_skipped", created.length - emitCap, {});
    }
    return created.length;
  } catch {
    return 0;
  }
}

/**
 * Sweep pass (contract §3): for every published sweep-triggered playbook in
 * an orchestration-enabled org, evaluate a BOUNDED candidate set and activate
 * matching opportunities. Stateless interval gating: a sweep with
 * intervalMinutes=15 runs on tick minutes 0/15/30/45 — no stored cursor, and
 * the activation dedupe (active-instance partial unique + reentry cooldown)
 * makes an extra evaluation harmless.
 *
 * v0 candidate sources are pragmatic, not general: an eligibility that
 * references `derived.callback_overdue_minutes` sweeps the org's overdue
 * callbacks; anything else sweeps the least-recently-touched open
 * opportunities. 50 candidates per playbook per firing; misses are caught on
 * the next firing.
 */
export async function runOrchestrationSweeps(now = new Date()): Promise<{
  evaluated: number;
  activated: number;
}> {
  const out = { evaluated: 0, activated: 0 };
  if (!isAdminConfigured()) return out;
  try {
    const admin = createAdminClient();
    const { data: pbs } = await admin
      .from("playbooks")
      .select("id, org_id, version, definition")
      .eq("status", "published")
      .limit(100);
    const sweeps = ((pbs ?? []) as {
      id: string;
      org_id: string;
      version: number;
      definition: PlaybookDefinition;
    }[]).filter((p) => p.definition?.trigger?.kind === "sweep");
    if (!sweeps.length) return out;

    const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    const enabledCache = new Map<string, { enabled: boolean; timezone: string }>();

    for (const pb of sweeps) {
      const trigger = pb.definition.trigger as { kind: "sweep"; intervalMinutes: number };
      const interval = Math.max(5, Math.round(Number(trigger.intervalMinutes) || 15));
      if (minuteOfDay % interval !== 0) continue;

      const orgId = String(pb.org_id);
      if (!enabledCache.has(orgId)) {
        enabledCache.set(orgId, await orgOrchestrationConfig(admin, orgId));
      }
      const orgCfg = enabledCache.get(orgId);
      if (!orgCfg?.enabled) continue;
      // Promised callback times are FLOATING wall clocks. Comparing them to a
      // real UTC instant makes a promise that is still an hour away look hours
      // overdue — and this path ESCALATES, so it would nudge owners and raise
      // hot work items over promises nobody has broken. Worse, Date.parse on
      // an offset-less string reads the SERVER's zone, so the error changed
      // with where the code ran.
      const floatingNow = zonedFloatingNow(now, orgCfg.timezone);

      const needsCallbacks = JSON.stringify(pb.definition.eligibility ?? {}).includes(
        "callback_overdue_minutes",
      );

      // Candidates: (opportunityId, leadId, derived) triples, bounded.
      const candidates: {
        opportunityId: string;
        leadId: string | null;
        derived: Record<string, unknown>;
      }[] = [];
      if (needsCallbacks) {
        const { data: cbs } = await admin
          .from("callbacks")
          .select("lead_id, due_at")
          .eq("org_id", orgId)
          .not("status", "in", '("completed","cancelled")')
          .not("lead_id", "is", null)
          .lte("due_at", floatingNow)
          .order("due_at", { ascending: true })
          .limit(50);
        for (const cb of cbs ?? []) {
          const opp = await getOpenOpportunityByLead(orgId, String(cb.lead_id));
          if (!opp) continue;
          // Both sides are wall clocks in the org's zone, so the difference is
          // exact without either being converted to an instant.
          const overdueMin = Math.max(
            0,
            Math.round(floatingMinutesBetween(String(cb.due_at), floatingNow)),
          );
          candidates.push({
            opportunityId: opp.id,
            leadId: String(cb.lead_id),
            derived: { callback_overdue_minutes: overdueMin },
          });
        }
      } else {
        const { data: opps } = await admin
          .from("opportunities")
          .select("id, lead_id, last_touched_at, next_action_due_at")
          .eq("org_id", orgId)
          .eq("op_status", "open")
          .order("last_touched_at", { ascending: true, nullsFirst: true })
          .limit(50);
        for (const o of opps ?? []) {
          const last = o.last_touched_at ? Date.parse(String(o.last_touched_at)) : NaN;
          const due = o.next_action_due_at
            ? Date.parse(String(o.next_action_due_at))
            : NaN;
          candidates.push({
            opportunityId: String(o.id),
            leadId: o.lead_id ? String(o.lead_id) : null,
            derived: {
              minutes_since_last_touch: Number.isFinite(last)
                ? Math.round((now.getTime() - last) / 60_000)
                : null,
              next_action_overdue_minutes:
                Number.isFinite(due) && due < now.getTime()
                  ? Math.round((now.getTime() - due) / 60_000)
                  : 0,
            },
          });
        }
      }

      for (const cand of candidates) {
        out.evaluated++;
        const ctx = await conditionContextFor(
          admin,
          cand.opportunityId,
          cand.leadId,
          undefined,
        );
        ctx.derived = cand.derived;
        if (!evaluateConditions(pb.definition.eligibility, ctx, now)) continue;
        if (!(await reentryAllows(admin, pb.id, cand.opportunityId, pb.definition))) {
          continue;
        }
        const { error } = await admin.from("playbook_instances").insert({
          org_id: orgId,
          playbook_id: pb.id,
          playbook_version: pb.version,
          opportunity_id: cand.opportunityId,
          status: "active",
          current_step: 0,
        });
        if (!error) {
          out.activated++;
          count("orchestrate.activated", 1, { orgId });
        }
      }
    }
  } catch {
    count("orchestrate.sweep_fail", 1, {});
  }
  return out;
}

/**
 * Fire one orchestration event. Never throws; bounded; silent no-op unless
 * the org has orchestration ON and a published playbook listens.
 */
export async function emitOrchestrationEvent(input: EmitInput): Promise<void> {
  try {
    if (!isAdminConfigured() || !input.orgId || !input.leadId) return;
    const admin = createAdminClient();
    if (
      input.orgEnabledHint !== true &&
      !(await orgOrchestrationEnabled(admin, input.orgId))
    ) {
      return;
    }
    const playbooks = await publishedPlaybooksFor(admin, input.orgId, input.event);
    if (!playbooks.length) return;

    const opp = await getOpenOpportunityByLead(input.orgId, input.leadId);
    if (!opp) return;
    const ctx = await conditionContextFor(admin, opp.id, input.leadId, input.touch);

    for (const pb of playbooks) {
      const def = pb.definition;
      const trigger = def.trigger;
      if (trigger.kind !== "event") continue;
      if (!evaluateConditions(trigger.filter, ctx)) continue;
      if (!evaluateConditions(def.eligibility, ctx)) continue;
      if (!(await reentryAllows(admin, pb.id, opp.id, def))) continue;
      // The partial unique (one active instance per playbook+opportunity)
      // absorbs races and replays — a failed insert is the dedupe working.
      const { error } = await admin.from("playbook_instances").insert({
        org_id: input.orgId,
        playbook_id: pb.id,
        playbook_version: pb.version,
        opportunity_id: opp.id,
        status: "active",
        current_step: 0,
      });
      if (!error) {
        count("orchestrate.activated", 1, { orgId: input.orgId });
      } else if (error.code !== "23505") {
        count("orchestrate.activate_fail", 1, { orgId: input.orgId });
      }
    }
  } catch {
    count("orchestrate.emit_fail", 1, { orgId: String(input.orgId ?? "unknown") });
  }
}
