import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { createClient } from "../supabase/server";
import { LEAD_GROUPS, MANUAL_GROUP_KEY } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Org-defined lead groups.
//
// The buckets a workspace sorts its leads into. These used to be five hardcoded
// geographic keys shared by every tenant; they're now rows an org's admins own,
// which is what lets a nationwide book be split by whatever actually matters to
// that team (region, bill size, source list, campaign) instead of by someone
// else's four California/Texas metros.
//
// `description` is not decoration — it is the rule the AI classifier sorts
// against (see src/lib/ai/classify-leads.ts). "Dallas/Fort Worth area codes and
// cities" is a better group definition than the label "North Texas" alone, and
// an org improving that sentence directly improves its sorting.
//
// A group's `key` is immutable once created. It's what `leads.lead_group`
// stores, so renaming a key would orphan every lead already filed under it —
// the LABEL is what admins edit.
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadGroupDef {
  id: string;
  key: string;
  label: string;
  /** Plain-English rule the AI sorts against. Empty = label only. */
  description: string;
  /** 'sorted' — the AI may assign it. 'manual' — humans only, AI never picks it. */
  kind: "sorted" | "manual";
  sortOrder: number;
}

export interface LeadGroupWithCount extends LeadGroupDef {
  leadCount: number;
}

/** Display label for the Miscellaneous bucket (`lead_group IS NULL`). */
export const MISC_GROUP_LABEL = "Miscellaneous";

function rowToGroup(r: Record<string, unknown>): LeadGroupDef {
  return {
    id: String(r.id),
    key: String(r.key),
    label: String(r.label ?? r.key),
    description: String(r.description ?? ""),
    kind: r.kind === "manual" ? "manual" : "sorted",
    sortOrder: Number(r.sort_order ?? 0),
  };
}

/**
 * Turn a label into a stable key. Keys are lowercase, ASCII, and collision-free
 * within the org (the caller appends a suffix on conflict) so they're safe to
 * store in `leads.lead_group` and to send to the model.
 */
export function slugifyGroupKey(label: string): string {
  const base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "group";
}

/**
 * The org's groups, in display order. Falls back to the legacy fixed five when
 * the table hasn't been seeded for this org yet (a brand-new org created between
 * deploys, or a database where PART 17 hasn't been run) — the dialer and the
 * leads table must never render an empty group list just because a migration
 * is pending.
 */
export async function listLeadGroups(orgId: string | null): Promise<LeadGroupDef[]> {
  if (!orgId) return legacyGroups();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lead_groups")
      .select("*")
      .eq("org_id", orgId)
      .order("sort_order", { ascending: true });
    if (error || !data?.length) return legacyGroups();
    return data.map(rowToGroup);
  } catch {
    return legacyGroups();
  }
}

/** The pre-PART-17 taxonomy, as LeadGroupDefs. Used only as a safety net. */
function legacyGroups(): LeadGroupDef[] {
  return LEAD_GROUPS.map((key, i) => ({
    id: `legacy-${key}`,
    key,
    label: key === MANUAL_GROUP_KEY ? "Manual Dialing" : key[0].toUpperCase() + key.slice(1),
    description: "",
    kind: key === MANUAL_GROUP_KEY ? "manual" : "sorted",
    sortOrder: i,
  }));
}

/** Groups plus how many leads each currently holds, and the Miscellaneous count. */
export async function listLeadGroupsWithCounts(
  orgId: string | null,
): Promise<{ groups: LeadGroupWithCount[]; miscCount: number }> {
  const groups = await listLeadGroups(orgId);
  if (!orgId) return { groups: groups.map((g) => ({ ...g, leadCount: 0 })), miscCount: 0 };

  const supabase = await createClient();

  // HEAD + exact count per bucket, fired concurrently. Deliberately NOT one
  // select of every lead_group: an un-ranged PostgREST select silently caps at
  // 1,000 rows, so a 5,000-lead org would have reported counts that stopped
  // adding up — and these numbers are what an admin reads before deciding to
  // delete a group. A handful of HEAD requests is cheap and always exact.
  const countFor = async (key: string | null): Promise<number> => {
    try {
      let q = supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);
      q = key === null ? q.is("lead_group", null) : q.eq("lead_group", key);
      const { count } = await q;
      return count ?? 0;
    } catch {
      return 0;
    }
  };

  const [miscCount, ...groupCounts] = await Promise.all([
    countFor(null),
    ...groups.map((g) => countFor(g.key)),
  ]);

  return {
    groups: groups.map((g, i) => ({ ...g, leadCount: groupCounts[i] ?? 0 })),
    miscCount,
  };
}

/** True when `key` is a group this org actually has (or Miscellaneous/null). */
export async function isValidGroupKey(
  orgId: string | null,
  key: string | null | undefined,
): Promise<boolean> {
  if (key == null || key === "") return true; // Miscellaneous
  const groups = await listLeadGroups(orgId);
  return groups.some((g) => g.key === key);
}

export async function createLeadGroup(
  orgId: string,
  input: { label: string; description?: string; kind?: "sorted" | "manual" },
): Promise<{ group?: LeadGroupDef; error?: string }> {
  const label = input.label.trim();
  if (!label) return { error: "A group needs a name." };
  if (label.length > 60) return { error: "That name is too long (60 characters max)." };
  if (!isAdminConfigured()) return { error: "Database is not configured." };

  const admin = createAdminClient();
  const existing = await listLeadGroups(orgId);
  if (existing.length >= 40) {
    return { error: "That's the maximum of 40 groups. Delete one first." };
  }

  // Keys are permanent, so resolve collisions here rather than failing: two
  // groups named "North Texas" and "North Texas " must not fight over one key.
  const taken = new Set(existing.map((g) => g.key));
  const base = slugifyGroupKey(label);
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;

  const { data, error } = await admin
    .from("lead_groups")
    .insert({
      org_id: orgId,
      key,
      label,
      description: (input.description ?? "").trim().slice(0, 500),
      kind: input.kind === "manual" ? "manual" : "sorted",
      sort_order: existing.length,
    })
    .select("*")
    .single();

  if (error || !data) return { error: error?.message ?? "Couldn't create that group." };
  return { group: rowToGroup(data) };
}

export async function updateLeadGroup(
  orgId: string,
  id: string,
  patch: { label?: string; description?: string; kind?: "sorted" | "manual"; sortOrder?: number },
): Promise<{ group?: LeadGroupDef; error?: string }> {
  if (!isAdminConfigured()) return { error: "Database is not configured." };
  const fields: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) return { error: "A group needs a name." };
    fields.label = label.slice(0, 60);
  }
  if (patch.description !== undefined) {
    fields.description = patch.description.trim().slice(0, 500);
  }
  if (patch.kind !== undefined) fields.kind = patch.kind === "manual" ? "manual" : "sorted";
  if (patch.sortOrder !== undefined) fields.sort_order = Math.max(0, Math.floor(patch.sortOrder));
  if (!Object.keys(fields).length) return { error: "Nothing to update." };

  const admin = createAdminClient();
  // org_id in the filter, not just the id: a guessed uuid from another tenant
  // must not be editable even though this runs on the service-role client.
  const { data, error } = await admin
    .from("lead_groups")
    .update(fields)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();

  if (error || !data) return { error: error?.message ?? "Couldn't update that group." };
  return { group: rowToGroup(data) };
}

/**
 * Delete a group. Leads filed under it are NOT deleted — they fall back to
 * Miscellaneous, so removing a bucket can never destroy someone's book. That
 * un-filing happens first: if it fails, the group stays and the leads keep a
 * key that still resolves.
 */
export async function deleteLeadGroup(
  orgId: string,
  id: string,
): Promise<{ ok: boolean; movedToMisc: number; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, movedToMisc: 0, error: "Database is not configured." };
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("lead_groups")
    .select("key")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!row) return { ok: false, movedToMisc: 0, error: "That group no longer exists." };

  const key = String((row as { key: string }).key);
  const { data: moved, error: moveErr } = await admin
    .from("leads")
    .update({ lead_group: null })
    .eq("org_id", orgId)
    .eq("lead_group", key)
    .select("id");
  if (moveErr) {
    return { ok: false, movedToMisc: 0, error: "Couldn't move that group's leads to Miscellaneous." };
  }

  const { error } = await admin.from("lead_groups").delete().eq("id", id).eq("org_id", orgId);
  if (error) return { ok: false, movedToMisc: 0, error: error.message };
  return { ok: true, movedToMisc: moved?.length ?? 0 };
}
