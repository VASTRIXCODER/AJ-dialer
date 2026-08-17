import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";

// ─────────────────────────────────────────────────────────────────────────────
// Handing a lead pack to a rep.
//
// lead-packs.ts CUTS an upload into numbered packs ("Jan list · Pack 7"). This
// deals them out. They're deliberately separate concerns: packs are created
// once at import, assignment changes repeatedly over a pack's life.
//
// Two records, on purpose:
//   • lead_packs.assigned_to — the paperwork. Answers "what is Marcus holding?"
//     and survives leads being dispositioned, deleted or individually moved.
//   • leads.assigned_rep_id  — the routing. This is what the dial queue reads;
//     without it a pack assignment would be a label that changes nobody's work.
//
// Progress is COUNTED from the pack's leads on read, never stored: a stored
// counter would drift the moment a lead was dispositioned or reassigned.
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssignablePack {
  id: string;
  batch: string;
  seq: number;
  label: string;
  size: number;
  assignedTo: string | null;
  assignedToName: string;
  assignedAt: string | null;
  /** Live counts over the pack's CURRENT leads. */
  progress: {
    total: number;
    worked: number;
    remaining: number;
    appointments: number;
  };
}

type Row = Record<string, unknown>;

/** Who's asking, and may they deal packs out? Mirrors the other supervisor-only
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
  if (!orgId || !UUID.test(orgId)) return { ok: false, error: "Join an organization first." };
  if (!["owner", "admin", "manager"].includes(role))
    return { ok: false, error: "Only admins and managers can assign lead packs." };
  return { ok: true, userId: user.id, orgId };
}

/** The org's packs, newest first, with holder + live progress. */
export async function listAssignablePacks(): Promise<AssignablePack[]> {
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
        .order("seq", { ascending: true })
        .limit(300),
      admin.from("organization_members").select("user_id,name").eq("org_id", scope.orgId),
    ]);
    const rows = (packs ?? []) as Row[];
    if (!rows.length) return [];

    const nameById = new Map(
      ((members ?? []) as Row[]).map((m) => [String(m.user_id), String(m.name ?? "")]),
    );

    // One query for every pack's leads, bucketed in memory — per-pack count
    // queries would be a round trip per pack on a screen that lists them all.
    const { data: leads } = await admin
      .from("leads")
      .select("lead_pack_id,status")
      .in(
        "lead_pack_id",
        rows.map((r) => String(r.id)),
      )
      .limit(100_000);

    const stats = new Map<string, { total: number; worked: number; appointments: number }>();
    for (const l of (leads ?? []) as Row[]) {
      const pid = String(l.lead_pack_id ?? "");
      if (!pid) continue;
      const s = stats.get(pid) ?? { total: 0, worked: 0, appointments: 0 };
      s.total++;
      const status = String(l.status ?? "new");
      if (status !== "new") s.worked++; // "worked" = has left the untouched state
      if (status === "appointment") s.appointments++;
      stats.set(pid, s);
    }

    return rows.map((r) => {
      const id = String(r.id);
      const s = stats.get(id) ?? { total: 0, worked: 0, appointments: 0 };
      const assignedTo = r.assigned_to ? String(r.assigned_to) : null;
      return {
        id,
        batch: String(r.batch ?? ""),
        seq: Number(r.seq ?? 1),
        label: String(r.label ?? ""),
        size: Number(r.size ?? 0),
        assignedTo,
        assignedToName: assignedTo ? nameById.get(assignedTo) || "Teammate" : "",
        assignedAt: r.assigned_at ? String(r.assigned_at) : null,
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
 * Hand a pack to a rep — or, with `repId: null`, take it back.
 *
 * Reclaiming clears the rep from the pack and its leads but touches NO lead
 * status: it redistributes the remaining work, it never undoes work already
 * done. The pack keeps its leads either way; only who's holding it changes.
 */
export async function assignPack(
  packId: string,
  repId: string | null,
): Promise<{ ok: boolean; error?: string; leads?: number }> {
  const scope = await supervisorScope();
  if (!scope.ok) return { ok: false, error: scope.error };
  if (!UUID.test(packId)) return { ok: false, error: "Unknown pack." };
  if (repId !== null && !UUID.test(repId)) return { ok: false, error: "Pick a rep to assign to." };

  try {
    const admin = createAdminClient();

    // The pack must belong to the caller's org — never deal another org's work.
    const { data: pack } = await admin
      .from("lead_packs")
      .select("id")
      .eq("id", packId)
      .eq("org_id", scope.orgId)
      .maybeSingle();
    if (!pack) return { ok: false, error: "Pack not found." };

    // A non-null target must be an ACTIVE member of this org, so a pack can't
    // be dealt to someone who was removed (their leads would vanish from every
    // queue — assigned to a user nobody can see).
    if (repId) {
      const { data: member } = await admin
        .from("organization_members")
        .select("user_id")
        .eq("org_id", scope.orgId)
        .eq("user_id", repId)
        .eq("status", "active")
        .maybeSingle();
      if (!member)
        return { ok: false, error: "That person isn't an active member of your organization." };
    }

    // Routing first: if stamping the leads fails, the pack still reads as
    // unassigned, which matches reality. The reverse order would claim a rep
    // holds work that never reached their queue.
    const { data: touched, error: leadErr } = await admin
      .from("leads")
      .update({ assigned_rep_id: repId })
      .eq("lead_pack_id", packId)
      .eq("org_id", scope.orgId)
      .select("id");
    if (leadErr) return { ok: false, error: leadErr.message };

    const { error: packErr } = await admin
      .from("lead_packs")
      .update({
        assigned_to: repId,
        assigned_by: repId ? scope.userId : null,
        assigned_at: repId ? new Date().toISOString() : null,
      })
      .eq("id", packId)
      .eq("org_id", scope.orgId);
    if (packErr) return { ok: false, error: packErr.message };

    return { ok: true, leads: touched?.length ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't assign that pack." };
  }
}
