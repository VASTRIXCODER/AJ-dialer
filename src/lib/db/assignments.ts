import "server-only";

import {
  deriveDueFlags,
  isAssignmentDialingMode,
  isAssignmentStatus,
  MAX_ALLOCATION_CANDIDATES,
  planAllocationLeadIds,
  summarizeProgress,
  type AllocationSourceKind,
  type AssignmentDialingMode,
  type AssignmentProgress,
  type AssignmentStatus,
  EMPTY_PROGRESS,
} from "../assignments/plan";
import { leads as demoLeads } from "../data";
import { isDialableStatus } from "../leads/dialable";
import { sanitizeFilterSpec, type FilterSpec } from "../leads/filter-spec";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { logLeadEventBulk } from "./lead-events";
import { getFilteredLeadIds } from "./leads-filter";
import type { Scope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// Assignments — lead_packs as the UNIT OF WORK (Phase 1 · D1).
//
// A pack used to be just a numbered slice of an upload. It is now a real
// assignment: status, priority, due date, dialing policy, and an audit trail
// (assignment_events). This module is the ONLY writer for those columns.
//
// Allocation is atomic in SQL (app_allocate_assignment: FOR UPDATE SKIP LOCKED,
// never-dialed-first, unassigned+eligible only). Candidate narrowing by
// FilterSpec happens HERE via app_filter_leads (ids → p_lead_ids) so there is
// exactly one filter compiler in the product.
//
// Progress is COUNTED from the pack's leads on read, never stored (the same
// contract lead-pack-assign.ts established) — a stored counter would drift the
// moment a lead was dispositioned or reassigned. One leads query covers every
// pack on the page; the buckets fold in memory (src/lib/assignments/plan.ts).
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

export interface AssignmentRecord {
  id: string;
  label: string;
  batch: string;
  seq: number;
  size: number;
  status: AssignmentStatus;
  priority: number;
  dueDate: string | null;
  dialingMode: AssignmentDialingMode;
  maxAttempts: number | null;
  cooldownHours: number | null;
  ordering: string;
  source: string;
  campaignId: string | null;
  assignedTo: string | null;
  assignedToName: string;
  assignedAt: string | null;
  createdAt: string;
  progress: AssignmentProgress;
  overdue: boolean;
  dueSoon: boolean;
}

export interface AssignmentEvent {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AllocationPreview {
  eligible: number;
  wouldAllocate: number;
  excludedDnc: number;
  excludedNoPhone: number;
  excludedAssigned: number;
  excludedIneligible: number;
}

const EMPTY_PREVIEW: AllocationPreview = {
  eligible: 0,
  wouldAllocate: 0,
  excludedDnc: 0,
  excludedNoPhone: 0,
  excludedAssigned: 0,
  excludedIneligible: 0,
};

export interface AllocationPolicy {
  priority?: number;
  dueDate?: string | null;
  dialingMode?: AssignmentDialingMode;
  maxAttempts?: number | null;
  cooldownHours?: number | null;
  campaignId?: string | null;
}

export interface AllocationSource {
  kind: AllocationSourceKind;
  /** Raw FilterSpec (sanitized at this boundary) when kind === "filter". */
  filter?: unknown;
  /** Smart-list id when kind === "smart_list" — its stored filter is used. */
  smartListId?: string;
}

function rowToRecord(
  r: Row,
  nameById: Map<string, string>,
  progress: AssignmentProgress,
  now: Date,
): AssignmentRecord {
  const status = isAssignmentStatus(r.status) ? r.status : "active";
  const dueDate = r.due_date ? String(r.due_date) : null;
  const flags = deriveDueFlags(dueDate, status, now);
  const assignedTo = r.assigned_to ? String(r.assigned_to) : null;
  return {
    id: String(r.id),
    label: String(r.label ?? ""),
    batch: String(r.batch ?? ""),
    seq: Number(r.seq ?? 1),
    size: Number(r.size ?? 0),
    status,
    priority: Number(r.priority ?? 0),
    dueDate,
    dialingMode: isAssignmentDialingMode(r.dialing_mode) ? r.dialing_mode : "either",
    maxAttempts: r.max_attempts == null ? null : Number(r.max_attempts),
    cooldownHours: r.cooldown_hours == null ? null : Number(r.cooldown_hours),
    ordering: String(r.ordering ?? "file"),
    source: String(r.source ?? "import"),
    campaignId: r.campaign_id ? String(r.campaign_id) : null,
    assignedTo,
    assignedToName: assignedTo ? nameById.get(assignedTo) || "Teammate" : "",
    assignedAt: r.assigned_at ? String(r.assigned_at) : null,
    createdAt: String(r.created_at ?? ""),
    progress,
    overdue: flags.overdue,
    dueSoon: flags.dueSoon,
  };
}

/** One query for EVERY listed pack's leads, folded into per-pack buckets. */
async function progressByPack(
  packIds: string[],
): Promise<Map<string, AssignmentProgress>> {
  const out = new Map<string, AssignmentProgress>();
  if (!packIds.length) return out;
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("lead_pack_id,status,last_contacted_at")
    .in("lead_pack_id", packIds)
    .limit(100_000);
  const grouped = new Map<string, { status: string; lastContactedAt: string | null }[]>();
  for (const l of (data ?? []) as Row[]) {
    const pid = String(l.lead_pack_id ?? "");
    if (!pid) continue;
    const arr = grouped.get(pid) ?? [];
    arr.push({
      status: String(l.status ?? "new"),
      lastContactedAt: l.last_contacted_at ? String(l.last_contacted_at) : null,
    });
    grouped.set(pid, arr);
  }
  for (const [pid, rows] of grouped) out.set(pid, summarizeProgress(rows));
  return out;
}

async function memberNames(orgId: string): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organization_members")
    .select("user_id,name")
    .eq("org_id", orgId);
  return new Map(
    ((data ?? []) as Row[]).map((m) => [String(m.user_id), String(m.name ?? "")]),
  );
}

/**
 * The org's assignments, newest first, with holder + live buckets. Supervisors
 * see everything; a rep calling this only sees packs assigned to them — the
 * route relies on that so one GET serves both roles honestly.
 */
export async function listAssignments(scope: Scope): Promise<AssignmentRecord[]> {
  if (!isAdminConfigured() || !scope.orgId) return [];
  try {
    const admin = createAdminClient();
    let q = admin
      .from("lead_packs")
      .select("*")
      .eq("org_id", scope.orgId)
      .order("created_at", { ascending: false })
      .order("seq", { ascending: true })
      .limit(300);
    if (!scope.supervisor) q = q.eq("assigned_to", scope.userId);
    const [{ data: packs }, names] = await Promise.all([q, memberNames(scope.orgId)]);
    const rows = (packs ?? []) as Row[];
    if (!rows.length) return [];
    const progress = await progressByPack(rows.map((r) => String(r.id)));
    const now = new Date();
    return rows.map((r) =>
      rowToRecord(r, names, progress.get(String(r.id)) ?? { ...EMPTY_PROGRESS }, now),
    );
  } catch {
    return [];
  }
}

/**
 * The packs handed to ONE rep — the My Assignments workspace. Includes
 * completed packs (they fill the Done lane); only archived ones drop out.
 */
export async function getMyAssignments(
  userId: string,
  orgId: string | null,
): Promise<AssignmentRecord[]> {
  if (!isAdminConfigured() || !orgId || !UUID.test(orgId)) return [];
  try {
    const admin = createAdminClient();
    const [{ data: packs }, names] = await Promise.all([
      admin
        .from("lead_packs")
        .select("*")
        .eq("org_id", orgId)
        .eq("assigned_to", userId)
        .in("status", ["active", "paused", "completed"])
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200),
      memberNames(orgId),
    ]);
    const rows = (packs ?? []) as Row[];
    if (!rows.length) return [];
    const progress = await progressByPack(rows.map((r) => String(r.id)));
    const now = new Date();
    return rows.map((r) =>
      rowToRecord(r, names, progress.get(String(r.id)) ?? { ...EMPTY_PROGRESS }, now),
    );
  } catch {
    return [];
  }
}

/** One assignment with live buckets — null when it isn't visible to `scope`
 *  (wrong org, or a rep asking about someone else's pack). */
export async function getAssignment(
  scope: Scope,
  packId: string,
): Promise<AssignmentRecord | null> {
  if (!isAdminConfigured() || !scope.orgId || !UUID.test(packId)) return null;
  try {
    const admin = createAdminClient();
    const { data: pack } = await admin
      .from("lead_packs")
      .select("*")
      .eq("id", packId)
      .eq("org_id", scope.orgId)
      .maybeSingle();
    if (!pack) return null;
    const r = pack as Row;
    if (!scope.supervisor && String(r.assigned_to ?? "") !== scope.userId) return null;
    const [names, progress] = await Promise.all([
      memberNames(scope.orgId),
      progressByPack([packId]),
    ]);
    return rowToRecord(r, names, progress.get(packId) ?? { ...EMPTY_PROGRESS }, new Date());
  } catch {
    return null;
  }
}

/** The pack's audit feed, newest first, with actor names resolved. */
export async function getAssignmentEvents(
  packId: string,
  orgId: string,
): Promise<AssignmentEvent[]> {
  if (!isAdminConfigured() || !UUID.test(packId) || !UUID.test(orgId)) return [];
  try {
    const admin = createAdminClient();
    const [{ data: events }, names] = await Promise.all([
      admin
        .from("assignment_events")
        .select("*")
        .eq("pack_id", packId)
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50),
      memberNames(orgId),
    ]);
    return ((events ?? []) as Row[]).map((e) => {
      const actorId = e.actor_id ? String(e.actor_id) : null;
      return {
        id: String(e.id),
        action: String(e.action ?? ""),
        actorId,
        actorName: actorId ? names.get(actorId) || "Teammate" : "System",
        payload: (e.payload as Record<string, unknown>) ?? {},
        createdAt: String(e.created_at ?? ""),
      };
    });
  } catch {
    return [];
  }
}

/** Fire-and-forget audit row — an event line must never fail the mutation. */
function logAssignmentEvent(input: {
  orgId: string;
  packId: string;
  actorId: string;
  action: string;
  payload?: Record<string, unknown>;
}): void {
  if (!isAdminConfigured()) return;
  void (async () => {
    try {
      await createAdminClient().from("assignment_events").insert({
        org_id: input.orgId,
        pack_id: input.packId,
        actor_id: UUID.test(input.actorId) ? input.actorId : null,
        action: input.action,
        payload: input.payload ?? {},
      });
    } catch {
      /* audit is best-effort by contract */
    }
  })();
}

/** Resolve a source's candidate ids. Returns null for the pool (the RPC scans
 *  everything), an id list for filter/smart-list — or an error string. */
async function resolveSourceIds(
  scope: Scope,
  source: AllocationSource,
): Promise<{ ok: true; leadIds: string[] | null } | { ok: false; error: string }> {
  if (source.kind === "pool") return { ok: true, leadIds: null };

  let filter: FilterSpec | null = null;
  if (source.kind === "filter") {
    filter = sanitizeFilterSpec(source.filter);
    if (!filter) return { ok: false, error: "That filter has no valid conditions." };
  } else {
    const listId = String(source.smartListId ?? "");
    if (!UUID.test(listId)) return { ok: false, error: "Pick a smart list first." };
    const admin = createAdminClient();
    const { data } = await admin
      .from("smart_lists")
      .select("filter")
      .eq("id", listId)
      .eq("org_id", scope.orgId as string)
      .maybeSingle();
    filter = data ? sanitizeFilterSpec((data as Row).filter) : null;
    if (!filter) return { ok: false, error: "That smart list no longer exists." };
  }

  // assignments.manage IS the authority to draw from the org pool — the caller
  // already passed the route's permission gate, so the filter resolves
  // org-wide even when the actor's role isn't a supervisor role.
  const ids = await getFilteredLeadIds(
    { ...scope, supervisor: true },
    filter,
    MAX_ALLOCATION_CANDIDATES,
  );
  return planAllocationLeadIds(source.kind, ids);
}

/**
 * Demo twin of app_preview_assignment over the bundled book, so the wizard's
 * numbers stay alive without a service role. Same bucket order of precedence
 * as the SQL: dnc → no_phone → assigned → ineligible → eligible.
 */
function demoPreview(leadIds: string[] | null, count: number): AllocationPreview {
  const pool = leadIds
    ? demoLeads.filter((l) => leadIds.includes(l.id))
    : demoLeads;
  const p = { ...EMPTY_PREVIEW };
  for (const l of pool) {
    const digits = (l.phone ?? "").replace(/\D/g, "");
    if (l.status === "dnc") p.excludedDnc += 1;
    else if (digits.length < 10) p.excludedNoPhone += 1;
    else if (l.assignedRepId) p.excludedAssigned += 1;
    else if (!isDialableStatus(l.status)) p.excludedIneligible += 1;
    else p.eligible += 1;
  }
  p.wouldAllocate = Math.min(p.eligible, Math.max(0, count));
  return p;
}

/** What an allocation WOULD take, with exact exclusion reasons. No locks. */
export async function previewAllocation(input: {
  orgId: string | null;
  leadIds: string[] | null;
  count: number;
}): Promise<AllocationPreview> {
  const count = Math.max(0, Math.floor(input.count) || 0);
  if (!isAdminConfigured() || !input.orgId) return demoPreview(input.leadIds, count);
  try {
    const { data, error } = await createAdminClient().rpc("app_preview_assignment", {
      p_org: input.orgId,
      p_lead_ids: input.leadIds?.length ? input.leadIds : null,
      p_count: count,
    });
    if (error || !data) return { ...EMPTY_PREVIEW };
    const r = data as Partial<Record<keyof AllocationPreview, unknown>>;
    return {
      eligible: Number(r.eligible ?? 0),
      wouldAllocate: Number(r.wouldAllocate ?? 0),
      excludedDnc: Number(r.excludedDnc ?? 0),
      excludedNoPhone: Number(r.excludedNoPhone ?? 0),
      excludedAssigned: Number(r.excludedAssigned ?? 0),
      excludedIneligible: Number(r.excludedIneligible ?? 0),
    };
  } catch {
    return { ...EMPTY_PREVIEW };
  }
}

/** Preview for a SOURCE (pool / filter / smart list) — resolves candidate ids
 *  first, exactly the way the commit will, so the numbers can't disagree. */
export async function previewSourceAllocation(
  scope: Scope,
  source: AllocationSource,
  count: number,
): Promise<{ preview: AllocationPreview; error?: string }> {
  if (source.kind !== "pool" && !isAdminConfigured()) {
    // Demo mode can still preview the pool; typed sources need the RPC chain.
    return { preview: { ...EMPTY_PREVIEW }, error: "Connect Supabase to preview filters." };
  }
  const resolved = await resolveSourceIds(scope, source);
  if (!resolved.ok) return { preview: { ...EMPTY_PREVIEW }, error: resolved.error };
  return {
    preview: await previewAllocation({
      orgId: scope.orgId,
      leadIds: resolved.leadIds,
      count,
    }),
  };
}

/** A rep a pack may be handed to must be an ACTIVE member of this org. */
async function validateRep(
  orgId: string,
  repId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID.test(repId)) return { ok: false, error: "Pick a rep to assign to." };
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("organization_members")
    .select("user_id, status")
    .eq("org_id", orgId)
    .eq("user_id", repId)
    .maybeSingle();
  if (!member) return { ok: false, error: "That person isn't in your organization." };
  if (String((member as Row).status) !== "active") {
    return {
      ok: false,
      error: "That teammate is still pending approval — approve them in Admin first.",
    };
  }
  return { ok: true };
}

/**
 * Allocate up to `count` eligible unassigned leads into a NEW assignment for
 * `repId`. Atomic (app_allocate_assignment) — two managers clicking Commit at
 * the same moment can never deal the same lead twice. Filter / smart-list
 * sources resolve to candidate ids first; the pool passes null and lets the
 * RPC's own eligibility scan pick (never-dialed first).
 */
export async function allocateAssignment(input: {
  orgId: string;
  actorId: string;
  repId: string;
  count: number;
  label: string;
  policy?: AllocationPolicy;
  source?: AllocationSource;
}): Promise<{ ok: boolean; error?: string; packId?: string; allocated?: number }> {
  if (!isAdminConfigured()) {
    return { ok: false, error: "Connect Supabase to allocate assignments." };
  }
  if (!UUID.test(input.orgId)) return { ok: false, error: "Join an organization first." };
  const count = Math.floor(input.count) || 0;
  if (count < 1) return { ok: false, error: "Pick how many leads to allocate." };
  const label = (input.label || "").trim().slice(0, 160);
  if (!label) return { ok: false, error: "Give this assignment a name." };

  const repOk = await validateRep(input.orgId, input.repId);
  if (!repOk.ok) return { ok: false, error: repOk.error };

  const source: AllocationSource = input.source ?? { kind: "pool" };
  const scope: Scope = { userId: input.actorId, orgId: input.orgId, supervisor: true };
  const resolved = await resolveSourceIds(scope, source);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const policy = input.policy ?? {};
  const sanitizedFilter =
    source.kind === "filter" ? sanitizeFilterSpec(source.filter) : null;
  try {
    const { data, error } = await createAdminClient().rpc("app_allocate_assignment", {
      p_org: input.orgId,
      p_actor: input.actorId,
      p_rep: input.repId,
      p_count: Math.min(count, MAX_ALLOCATION_CANDIDATES),
      p_label: label,
      p_opts: {
        batch: "assignment",
        priority: Math.max(0, Math.floor(policy.priority ?? 0)),
        dueDate: policy.dueDate || null,
        dialingMode: isAssignmentDialingMode(policy.dialingMode)
          ? policy.dialingMode
          : "either",
        maxAttempts:
          policy.maxAttempts && policy.maxAttempts > 0
            ? Math.floor(policy.maxAttempts)
            : null,
        cooldownHours:
          policy.cooldownHours && policy.cooldownHours > 0
            ? Math.floor(policy.cooldownHours)
            : null,
        campaignId: policy.campaignId || null,
        ordering: "file",
        // Provenance: where these leads came from, replayable later.
        source: source.kind === "pool" ? "manual" : source.kind,
        filterSnapshot:
          source.kind === "filter"
            ? sanitizedFilter
            : source.kind === "smart_list"
              ? { smartListId: source.smartListId }
              : null,
      },
      p_lead_ids: resolved.leadIds,
    });
    if (error) return { ok: false, error: error.message };
    const r = (data ?? {}) as { packId?: string | null; allocated?: number };
    const allocated = Number(r.allocated ?? 0);
    if (!r.packId || allocated === 0) {
      return {
        ok: false,
        error: "No eligible unassigned leads matched — nothing was allocated.",
      };
    }
    const packId = String(r.packId);

    // Lead 360 timelines: every allocated lead shows "assigned" with the pack.
    // Fire-and-forget, like every audit write.
    void (async () => {
      try {
        const { data: moved } = await createAdminClient()
          .from("leads")
          .select("id")
          .eq("lead_pack_id", packId)
          .limit(MAX_ALLOCATION_CANDIDATES);
        logLeadEventBulk({
          leadIds: ((moved ?? []) as Row[]).map((l) => String(l.id)),
          orgId: input.orgId,
          actorId: input.actorId,
          kind: "assignment",
          payload: { packId, repId: input.repId, count: allocated },
        });
      } catch {
        /* best-effort */
      }
    })();

    return { ok: true, packId, allocated };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't allocate that assignment.",
    };
  }
}

export type AssignmentAction =
  | "pause"
  | "resume"
  | "archive"
  | "edit"
  | "reclaim"
  | "reassign";

export interface AssignmentUpdate {
  packId: string;
  action: AssignmentAction;
  /** reassign only — the new holder. */
  repId?: string;
  /** edit only — policy fields to patch. */
  patch?: {
    label?: string;
    priority?: number;
    dueDate?: string | null;
    dialingMode?: AssignmentDialingMode;
    maxAttempts?: number | null;
    cooldownHours?: number | null;
  };
}

/**
 * Every lifecycle mutation on an assignment. Each writes an assignment_events
 * row; reclaim/reassign additionally stamp every affected lead's own timeline
 * (logLeadEventBulk) because those two change WHOSE queue the lead is in.
 *
 * Reclaim keeps lead-pack-assign's exact semantics: it clears the rep from the
 * pack and its leads but touches NO lead status — it redistributes remaining
 * work, it never undoes work already done.
 */
export async function updateAssignment(
  scope: Scope,
  input: AssignmentUpdate,
): Promise<{ ok: boolean; error?: string; leads?: number }> {
  if (!isAdminConfigured() || !scope.orgId) {
    return { ok: false, error: "Connect Supabase to manage assignments." };
  }
  if (!UUID.test(input.packId)) return { ok: false, error: "Unknown assignment." };
  const orgId = scope.orgId;

  try {
    const admin = createAdminClient();
    const { data: pack } = await admin
      .from("lead_packs")
      .select("id, status, assigned_to, label")
      .eq("id", input.packId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!pack) return { ok: false, error: "Assignment not found." };
    const packRow = pack as Row;

    const setStatus = async (status: AssignmentStatus, action: string) => {
      const { error } = await admin
        .from("lead_packs")
        .update({ status })
        .eq("id", input.packId)
        .eq("org_id", orgId);
      if (error) return { ok: false as const, error: error.message };
      logAssignmentEvent({
        orgId,
        packId: input.packId,
        actorId: scope.userId,
        action,
        payload: { from: String(packRow.status ?? "active"), to: status },
      });
      return { ok: true as const };
    };

    switch (input.action) {
      case "pause":
        return setStatus("paused", "paused");
      case "resume":
        return setStatus("active", "resumed");
      case "archive":
        return setStatus("archived", "archived");

      case "edit": {
        const patch = input.patch ?? {};
        const fields: Row = {};
        if (patch.label !== undefined) {
          const label = patch.label.trim().slice(0, 160);
          if (!label) return { ok: false, error: "An assignment needs a name." };
          fields.label = label;
        }
        if (patch.priority !== undefined)
          fields.priority = Math.max(0, Math.floor(patch.priority) || 0);
        if (patch.dueDate !== undefined) fields.due_date = patch.dueDate || null;
        if (patch.dialingMode !== undefined) {
          if (!isAssignmentDialingMode(patch.dialingMode))
            return { ok: false, error: "Unknown dialing mode." };
          fields.dialing_mode = patch.dialingMode;
        }
        if (patch.maxAttempts !== undefined)
          fields.max_attempts =
            patch.maxAttempts && patch.maxAttempts > 0
              ? Math.floor(patch.maxAttempts)
              : null;
        if (patch.cooldownHours !== undefined)
          fields.cooldown_hours =
            patch.cooldownHours && patch.cooldownHours > 0
              ? Math.floor(patch.cooldownHours)
              : null;
        if (!Object.keys(fields).length) return { ok: false, error: "Nothing to update." };
        const { error } = await admin
          .from("lead_packs")
          .update(fields)
          .eq("id", input.packId)
          .eq("org_id", orgId);
        if (error) return { ok: false, error: error.message };
        logAssignmentEvent({
          orgId,
          packId: input.packId,
          actorId: scope.userId,
          action: "edited",
          payload: { fields: Object.keys(fields) },
        });
        return { ok: true };
      }

      case "reclaim":
      case "reassign": {
        const repId = input.action === "reclaim" ? null : String(input.repId ?? "");
        if (repId !== null) {
          const repOk = await validateRep(orgId, repId);
          if (!repOk.ok) return { ok: false, error: repOk.error };
        }
        // Routing first: if stamping the leads fails, the pack still reads as
        // before, which matches reality (same ordering as assignPack).
        const { data: touched, error: leadErr } = await admin
          .from("leads")
          .update({ assigned_rep_id: repId })
          .eq("lead_pack_id", input.packId)
          .eq("org_id", orgId)
          .select("id");
        if (leadErr) return { ok: false, error: leadErr.message };
        const { error: packErr } = await admin
          .from("lead_packs")
          .update({
            assigned_to: repId,
            assigned_by: repId ? scope.userId : null,
            assigned_at: repId ? new Date().toISOString() : null,
          })
          .eq("id", input.packId)
          .eq("org_id", orgId);
        if (packErr) return { ok: false, error: packErr.message };

        const leadIds = ((touched ?? []) as Row[]).map((l) => String(l.id));
        logAssignmentEvent({
          orgId,
          packId: input.packId,
          actorId: scope.userId,
          action: input.action === "reclaim" ? "reclaimed" : "reassigned",
          payload: {
            from: packRow.assigned_to ? String(packRow.assigned_to) : null,
            to: repId,
            count: leadIds.length,
          },
        });
        logLeadEventBulk({
          leadIds,
          orgId,
          actorId: scope.userId,
          kind: "assignment",
          payload: { packId: input.packId, repId, count: leadIds.length },
        });
        return { ok: true, leads: leadIds.length };
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't update that assignment.",
    };
  }
}
