import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import { LEAD_GROUPS, type LeadGroup, type LeadStatus } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Lead packs — named batches of leads handed to a rep.
//
// Assignment is NON-DESTRUCTIVE: a pack stamps `assigned_rep_id` (so the leads
// enter that rep's queue) and `pack_id` (so the batch stays identifiable), but
// never touches `owner_id`. Whoever uploaded the list is still its uploader,
// which keeps attribution — and the per-rep Leads sections — intact.
//
// Progress is COUNTED from the member leads on read, never stored. A stored
// "worked: 47" would drift the moment a lead was dispositioned, deleted or
// reassigned; a count can't.
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses a lead must be in to be worth packing — the dialable ones. */
const PACKABLE: LeadStatus[] = ["new", "no_answer", "callback"];

/** Hard ceiling on one pack, so a fat-fingered size can't sweep a whole book. */
export const MAX_PACK_SIZE = 5000;

export interface PackSource {
  /** Restrict to one intake group, or null for any. */
  leadGroup?: LeadGroup | null;
  /** Restrict to one campaign, or null for any. */
  campaignId?: string | null;
  /** Skip leads already assigned to a rep (on by default — see buildPack). */
  onlyUnassigned?: boolean;
}

export interface LeadPack {
  id: string;
  name: string;
  assignedTo: string | null;
  assignedToName: string;
  createdBy: string | null;
  size: number;
  source: PackSource;
  status: "active" | "reclaimed";
  createdAt: string;
  reclaimedAt: string | null;
  /** Live counts over the pack's CURRENT members. */
  progress: {
    total: number;
    worked: number;
    remaining: number;
    appointments: number;
  };
}

type Row = Record<string, unknown>;

/** Who is asking, and may they manage packs? Mirrors the other supervisor-only
 *  lead writes: an org, a supervisory role, and a service role to act with. */
async function supervisorScope(): Promise<
  { ok: true; userId: string; orgId: string } | { ok: false; error: string }
> {
  if (!isSupabaseConfigured() || !isAdminConfigured())
    return { ok: false, error: "Connect Supabase to manage lead packs." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };
  const { data: prof } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .maybeSingle();
  const orgId = prof?.org_id ? String(prof.org_id) : null;
  const role = String(prof?.role ?? "rep");
  if (!orgId || !UUID.test(orgId))
    return { ok: false, error: "Join an organization first." };
  if (!["owner", "admin", "manager"].includes(role))
    return { ok: false, error: "Only admins and managers can assign lead packs." };
  return { ok: true, userId: user.id, orgId };
}

/**
 * How many leads a pack built from `source` could contain right now — the
 * number the create dialog previews before anyone commits to handing it over.
 */
export async function countAvailable(source: PackSource): Promise<number> {
  const scope = await supervisorScope();
  if (!scope.ok) return 0;
  try {
    const admin = createAdminClient();
    let q = admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("org_id", scope.orgId)
      .in("status", PACKABLE);
    if (source.onlyUnassigned !== false) q = q.is("assigned_rep_id", null);
    if (source.leadGroup) q = q.eq("lead_group", source.leadGroup);
    if (source.campaignId) q = q.eq("campaign_id", source.campaignId);
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Cut `size` leads matching `source` and hand them to `repId` as a named pack.
 *
 * Leads are taken in upload order (created_at) so a pack is a contiguous slice
 * of the list as it was uploaded, not a random scatter through it — the same
 * ordering the dial queue uses, so the rep works it in the order it was cut.
 */
export async function createLeadPack(input: {
  name: string;
  repId: string;
  size: number;
  source: PackSource;
}): Promise<{ ok: boolean; error?: string; packId?: string; assigned?: number }> {
  const scope = await supervisorScope();
  if (!scope.ok) return { ok: false, error: scope.error };

  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Give the pack a name." };
  if (!UUID.test(input.repId)) return { ok: false, error: "Pick a rep to assign to." };
  const size = Math.max(1, Math.min(Math.floor(input.size) || 0, MAX_PACK_SIZE));
  if (input.source.leadGroup && !LEAD_GROUPS.includes(input.source.leadGroup))
    return { ok: false, error: "Unknown lead group." };

  try {
    const admin = createAdminClient();

    // The rep must be an active member of THIS org — never hand a pack to
    // someone outside it, or to a removed member.
    const { data: member } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("org_id", scope.orgId)
      .eq("user_id", input.repId)
      .eq("status", "active")
      .maybeSingle();
    if (!member)
      return { ok: false, error: "That person isn't an active member of your organization." };

    // Pick the candidates.
    let q = admin
      .from("leads")
      .select("id")
      .eq("org_id", scope.orgId)
      .in("status", PACKABLE);
    if (input.source.onlyUnassigned !== false) q = q.is("assigned_rep_id", null);
    if (input.source.leadGroup) q = q.eq("lead_group", input.source.leadGroup);
    if (input.source.campaignId) q = q.eq("campaign_id", input.source.campaignId);
    const { data: candidates, error: pickErr } = await q
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(size);
    if (pickErr) return { ok: false, error: pickErr.message };

    const ids = (candidates ?? []).map((r) => String((r as Row).id));
    if (!ids.length)
      return { ok: false, error: "No leads match that filter — nothing to pack." };

    // Create the pack first: a lead pointing at a pack row that doesn't exist
    // would be worse than a pack with no members, which self-heals on reclaim.
    const { data: pack, error: packErr } = await admin
      .from("lead_packs")
      .insert({
        org_id: scope.orgId,
        name,
        assigned_to: input.repId,
        created_by: scope.userId,
        size: ids.length,
        source: input.source,
        status: "active",
      })
      .select("id")
      .maybeSingle();
    if (packErr || !pack) return { ok: false, error: packErr?.message ?? "Couldn't create the pack." };
    const packId = String((pack as Row).id);

    // Stamp membership + assignment in chunks (a few hundred UUIDs in one
    // PostgREST filter overflows the request URL). Re-asserting the source
    // filter on the UPDATE keeps a lead that got assigned between the SELECT
    // and here from being quietly stolen into this pack.
    const CHUNK = 100;
    let assigned = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      let u = admin
        .from("leads")
        .update({ assigned_rep_id: input.repId, pack_id: packId })
        .in("id", batch)
        .eq("org_id", scope.orgId);
      if (input.source.onlyUnassigned !== false) u = u.is("assigned_rep_id", null);
      const { data, error } = await u.select("id");
      if (error) return { ok: false, error: error.message, packId };
      assigned += data?.length ?? 0;
    }

    // Record what was actually stamped, not what we hoped to.
    if (assigned !== ids.length) {
      await admin.from("lead_packs").update({ size: assigned }).eq("id", packId);
    }
    return { ok: true, packId, assigned };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't create the pack." };
  }
}

/** Packs for the viewer's org, newest first, with live progress counts. */
export async function listLeadPacks(): Promise<LeadPack[]> {
  const scope = await supervisorScope();
  if (!scope.ok) return [];
  try {
    const admin = createAdminClient();
    const [{ data: packs }, { data: members }] = await Promise.all([
      admin
        .from("lead_packs")
        .select("*")
        .eq("org_id", scope.orgId)
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("organization_members")
        .select("user_id,name")
        .eq("org_id", scope.orgId),
    ]);
    const rows = (packs ?? []) as Row[];
    if (!rows.length) return [];

    const nameById = new Map(
      ((members ?? []) as Row[]).map((m) => [String(m.user_id), String(m.name ?? "")]),
    );

    // One query for every pack's members, bucketed in memory — N+1 count
    // queries would be a request per pack on a screen that lists all of them.
    const packIds = rows.map((r) => String(r.id));
    const { data: memberLeads } = await admin
      .from("leads")
      .select("pack_id,status")
      .in("pack_id", packIds)
      .limit(100_000);

    const stats = new Map<string, { total: number; worked: number; appointments: number }>();
    for (const l of (memberLeads ?? []) as Row[]) {
      const pid = String(l.pack_id ?? "");
      if (!pid) continue;
      const s = stats.get(pid) ?? { total: 0, worked: 0, appointments: 0 };
      s.total++;
      const status = String(l.status ?? "new");
      // "Worked" = anything that has left the untouched state.
      if (status !== "new") s.worked++;
      if (status === "appointment") s.appointments++;
      stats.set(pid, s);
    }

    return rows.map((r) => {
      const id = String(r.id);
      const s = stats.get(id) ?? { total: 0, worked: 0, appointments: 0 };
      const assignedTo = r.assigned_to ? String(r.assigned_to) : null;
      return {
        id,
        name: String(r.name ?? ""),
        assignedTo,
        assignedToName: assignedTo ? nameById.get(assignedTo) || "Teammate" : "",
        createdBy: r.created_by ? String(r.created_by) : null,
        size: Number(r.size ?? 0),
        source: (r.source ?? {}) as PackSource,
        status: String(r.status ?? "active") === "reclaimed" ? "reclaimed" : "active",
        createdAt: String(r.created_at ?? ""),
        reclaimedAt: r.reclaimed_at ? String(r.reclaimed_at) : null,
        progress: {
          total: s.total,
          worked: s.worked,
          remaining: Math.max(0, s.total - s.worked),
          appointments: s.appointments,
        },
      };
    });
  } catch {
    return [];
  }
}

/**
 * Take a pack back. Clears the rep assignment on every member lead so the leads
 * return to the unassigned pool, and marks the pack reclaimed.
 *
 * Members KEEP their pack_id: the pack row is history ("Marcus had these 200"),
 * and wiping the link would erase which leads were in it. Already-worked leads
 * keep their statuses — reclaiming redistributes work, it never undoes it.
 */
export async function reclaimLeadPack(
  packId: string,
): Promise<{ ok: boolean; error?: string; released?: number }> {
  const scope = await supervisorScope();
  if (!scope.ok) return { ok: false, error: scope.error };
  if (!UUID.test(packId)) return { ok: false, error: "Unknown pack." };
  try {
    const admin = createAdminClient();
    // Scope the lookup to the caller's org — never reclaim another org's pack.
    const { data: pack } = await admin
      .from("lead_packs")
      .select("id")
      .eq("id", packId)
      .eq("org_id", scope.orgId)
      .maybeSingle();
    if (!pack) return { ok: false, error: "Pack not found." };

    const { data, error } = await admin
      .from("leads")
      .update({ assigned_rep_id: null })
      .eq("pack_id", packId)
      .eq("org_id", scope.orgId)
      .select("id");
    if (error) return { ok: false, error: error.message };

    const { error: upErr } = await admin
      .from("lead_packs")
      .update({ status: "reclaimed", assigned_to: null, reclaimed_at: new Date().toISOString() })
      .eq("id", packId)
      .eq("org_id", scope.orgId);
    if (upErr) return { ok: false, error: upErr.message };

    return { ok: true, released: data?.length ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reclaim the pack." };
  }
}
