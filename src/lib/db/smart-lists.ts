import "server-only";

import type { LeadFieldDef } from "../leads/field-schema";
import {
  sanitizeFilterSpec,
  type FilterSpec,
} from "../leads/filter-spec";
import {
  SEEDED_SMART_LIST_FILTERS,
  SMART_LISTS,
  type SmartListTone,
} from "../leads/smart-lists";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import type { Scope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// Smart Lists 2.0 — dynamic saved queries (PART 30).
//
// A smart list is a NAMED FilterSpec row: the chips on /leads apply it through
// the exact same ?f= pipeline a hand-built filter uses, so a list can never
// select different rows than its filter says. Everything read from or written
// to `filter` goes through sanitizeFilterSpec at THIS boundary — the table is
// written by humans and old seeds, and a condition the sanitizer would drop at
// apply time must never survive in storage where it would silently widen a
// list (the "going cold without the 14 days" failure mode).
//
// Permissions (scope.supervisor = manager/admin/owner):
//   read    — any member: every shared list + their own private ones.
//   create  — any member may create PRIVATE lists; the ROUTE gates shared
//             creation on the leads.import permission (overrides included).
//   update  — owner, or manager+ for shared lists.
//   delete  — seeded lists (key != null): manager+ only, reps can't take the
//             org's defaults away; custom lists: owner or manager+.
//
// Demo fallback: without a service role the seeded lists are rebuilt from the
// legacy pure module (SMART_LISTS + SEEDED_SMART_LIST_FILTERS) so the chips
// row still renders; writes report a friendly error instead of crashing.
// ─────────────────────────────────────────────────────────────────────────────

export interface SmartListRecord {
  id: string;
  /** Seed key ('fresh', 'going_cold', …) — null for user-created lists. */
  key: string | null;
  name: string;
  description: string;
  tone: SmartListTone;
  /** SANITIZED — safe to encode into ?f= or hand to app_filter_leads as-is. */
  filter: FilterSpec;
  ownerId: string | null;
  shared: boolean;
  favorite: boolean;
  version: number;
  updatedAt: string;
}

export interface SmartListResult {
  list?: SmartListRecord;
  error?: string;
}

const TONES: ReadonlySet<string> = new Set([
  "success",
  "warning",
  "danger",
  "accent",
  "primary",
  "neutral",
]);

const MAX_LISTS = 100;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;

const cleanTone = (raw: unknown): SmartListTone =>
  typeof raw === "string" && TONES.has(raw) ? (raw as SmartListTone) : "neutral";

function rowToRecord(r: Record<string, unknown>): SmartListRecord | null {
  // Storage is trusted less than it's written: a row whose filter no longer
  // sanitizes to ANY valid condition can't be applied honestly, so it's
  // dropped from the listing rather than rendered as a chip that lies.
  const filter = sanitizeFilterSpec(r.filter);
  if (!filter) return null;
  return {
    id: String(r.id),
    key: r.key == null ? null : String(r.key),
    name: String(r.name ?? ""),
    description: String(r.description ?? ""),
    tone: cleanTone(r.tone),
    filter,
    ownerId: r.owner_id == null ? null : String(r.owner_id),
    shared: r.shared !== false,
    favorite: r.favorite === true,
    version: Number(r.version ?? 1),
    updatedAt: String(r.updated_at ?? r.created_at ?? new Date().toISOString()),
  };
}

/** The demo book is the solar sample org, so it gets all six seeded lists. */
function demoSmartLists(): SmartListRecord[] {
  return SMART_LISTS.map((sl) => ({
    id: `demo-${sl.id}`,
    key: sl.id,
    name: sl.label,
    description: sl.description,
    tone: sl.tone,
    filter: SEEDED_SMART_LIST_FILTERS[sl.id as keyof typeof SEEDED_SMART_LIST_FILTERS],
    ownerId: null,
    shared: true,
    favorite: false,
    version: 1,
    updatedAt: new Date(0).toISOString(),
  })).filter((l) => Boolean(l.filter));
}

/**
 * The lists this member can see: the org's shared ones plus their own private
 * ones, favorites first, then A-Z. NO live counts here — a count per chip is a
 * full filter scan each, so counting stays an explicit, per-list request.
 */
export async function listSmartLists(scope: Scope): Promise<SmartListRecord[]> {
  if (!isAdminConfigured() || !scope.orgId) return demoSmartLists();
  try {
    const { data, error } = await createAdminClient()
      .from("smart_lists")
      .select("*")
      .eq("org_id", scope.orgId)
      .or(`shared.eq.true,owner_id.eq.${scope.userId}`)
      .order("favorite", { ascending: false })
      .order("name", { ascending: true });
    if (error || !data) return [];
    return (data as Record<string, unknown>[])
      .map(rowToRecord)
      .filter((r): r is SmartListRecord => r !== null);
  } catch {
    return [];
  }
}

export async function createSmartList(
  scope: Scope,
  input: {
    name: string;
    description?: string;
    tone?: string;
    filter: unknown;
    shared?: boolean;
    favorite?: boolean;
  },
): Promise<SmartListResult> {
  const name = (input.name ?? "").trim();
  if (!name) return { error: "A list needs a name." };
  if (name.length > MAX_NAME) return { error: `That name is too long (${MAX_NAME} characters max).` };
  const filter = sanitizeFilterSpec(input.filter);
  if (!filter) return { error: "That filter has no valid conditions." };
  if (!isAdminConfigured() || !scope.orgId) {
    return { error: "Connect Supabase to save lists." };
  }

  const admin = createAdminClient();
  const { count, error: countErr } = await admin
    .from("smart_lists")
    .select("id", { count: "exact", head: true })
    .eq("org_id", scope.orgId);
  // A cap that cannot read its own count is spent. `count ?? 0` made a failed
  // read say "you have zero lists", which is the answer that lets the cap be
  // exceeded — the one thing a cap exists to stop.
  if (countErr || count === null) {
    return { error: "Couldn't check how many lists this workspace has. Try again in a moment." };
  }
  if (count >= MAX_LISTS) {
    return { error: `That's the maximum of ${MAX_LISTS} lists. Delete one first.` };
  }

  const { data, error } = await admin
    .from("smart_lists")
    .insert({
      org_id: scope.orgId,
      key: null, // user-created — never collides with the seeded namespace
      name,
      description: (input.description ?? "").trim().slice(0, MAX_DESCRIPTION),
      tone: cleanTone(input.tone),
      filter,
      owner_id: scope.userId,
      shared: input.shared !== false,
      favorite: input.favorite === true,
      updated_by: scope.userId,
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Couldn't save that list." };
  const list = rowToRecord(data as Record<string, unknown>);
  return list ? { list } : { error: "Couldn't save that list." };
}

export async function updateSmartList(
  scope: Scope,
  id: string,
  patch: {
    name?: string;
    description?: string;
    tone?: string;
    filter?: unknown;
    favorite?: boolean;
    shared?: boolean;
  },
): Promise<SmartListResult> {
  if (!isAdminConfigured() || !scope.orgId) {
    return { error: "Connect Supabase to manage lists." };
  }
  const admin = createAdminClient();
  // org_id in the filter, not just the id: a guessed uuid from another tenant
  // must not be reachable even on the service-role client.
  const { data: row } = await admin
    .from("smart_lists")
    .select("id, owner_id, shared, version")
    .eq("id", id)
    .eq("org_id", scope.orgId)
    .maybeSingle();
  if (!row) return { error: "That list no longer exists." };

  const ownerId = row.owner_id == null ? null : String(row.owner_id);
  const isOwner = ownerId != null && ownerId === scope.userId;
  // Shared lists belong to the org: owner or manager+. Private lists belong to
  // exactly one person — a manager can't quietly rewrite a rep's private view.
  const mayEdit = row.shared !== false ? isOwner || scope.supervisor : isOwner;
  if (!mayEdit) return { error: "You can't edit that list." };

  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { error: "A list needs a name." };
    fields.name = name.slice(0, MAX_NAME);
  }
  if (patch.description !== undefined) {
    fields.description = patch.description.trim().slice(0, MAX_DESCRIPTION);
  }
  if (patch.tone !== undefined) fields.tone = cleanTone(patch.tone);
  if (patch.filter !== undefined) {
    const filter = sanitizeFilterSpec(patch.filter);
    if (!filter) return { error: "That filter has no valid conditions." };
    fields.filter = filter;
  }
  if (patch.favorite !== undefined) fields.favorite = patch.favorite === true;
  if (patch.shared !== undefined) fields.shared = patch.shared === true;
  if (!Object.keys(fields).length) return { error: "Nothing to update." };

  fields.version = Number(row.version ?? 1) + 1;
  fields.updated_by = scope.userId;
  fields.updated_at = new Date().toISOString();

  const { data, error } = await admin
    .from("smart_lists")
    .update(fields)
    .eq("id", id)
    .eq("org_id", scope.orgId)
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Couldn't update that list." };
  const list = rowToRecord(data as Record<string, unknown>);
  return list ? { list } : { error: "Couldn't update that list." };
}

export async function deleteSmartList(
  scope: Scope,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured() || !scope.orgId) {
    return { ok: false, error: "Connect Supabase to manage lists." };
  }
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("smart_lists")
    .select("id, key, owner_id")
    .eq("id", id)
    .eq("org_id", scope.orgId)
    .maybeSingle();
  if (!row) return { ok: false, error: "That list no longer exists." };

  const seeded = row.key != null;
  const isOwner = row.owner_id != null && String(row.owner_id) === scope.userId;
  const mayDelete = seeded ? scope.supervisor : isOwner || scope.supervisor;
  if (!mayDelete) {
    return {
      ok: false,
      error: seeded
        ? "Only managers and above can delete a built-in list."
        : "You can't delete that list.",
    };
  }

  const { error } = await admin
    .from("smart_lists")
    .delete()
    .eq("id", id)
    .eq("org_id", scope.orgId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Health check for a list's filter against the org's RESOLVED field schema:
 * a condition referencing a custom field the org no longer has can never match
 * anything, which looks exactly like "the list is empty" — surface it as a
 * warning on the chip instead of letting it read as truth.
 */
export function validateSmartListFilter(
  spec: FilterSpec,
  orgFields: LeadFieldDef[],
): string[] {
  const customKeys = new Set(
    orgFields.filter((f) => f.source === "custom").map((f) => f.key),
  );
  const warnings: string[] = [];
  for (const group of spec.groups) {
    for (const cond of group.conditions) {
      if (cond.kind === "custom" && !customKeys.has(cond.key)) {
        warnings.push(
          `References a custom field this workspace doesn't have: "${cond.key}".`,
        );
      }
    }
  }
  return warnings;
}
