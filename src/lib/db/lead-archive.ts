import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import { logLeadEventBulk } from "./lead-events";
import { readProfileScope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// Bulk archive / unarchive — the reversible sibling of deleteLeads.
//
// Archiving sets leads.archived_at, which removes the lead from every default
// read (app_filter_leads appends `archived_at is null` unless the filter itself
// references the archived key) WITHOUT destroying the row, its call history, or
// its custom fields. Unarchiving clears the stamp and the lead re-enters the
// book exactly as it was.
//
// Deliberately MANAGER+ (unlike delete, where a rep may clear their own bad
// upload): archiving is a book-curation action over the SHARED org pool, and a
// rep silently hiding rows from everyone else's default view is exactly the
// confusion the archived flag exists to prevent. The route enforces the same
// gate; this re-check means neither layer is load-bearing alone.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/**
 * Set (or clear, when `archived` is false) archived_at on a batch of leads.
 * Batched like deleteLeads so a big sweep never overflows a request URL, and
 * scoped IN CODE to "this org's leads or my own" — never another org's.
 */
export async function setLeadsArchived(
  leadIds: string[],
  archived: boolean,
): Promise<{ updated: number; error?: string }> {
  if (!isSupabaseConfigured())
    return { updated: 0, error: "Connect Supabase to manage leads." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { updated: 0, error: "You must be signed in." };

    const ids = [...new Set(leadIds.filter((id) => UUID.test(id)))];
    if (!ids.length) return { updated: 0, error: "No valid leads selected." };

    const prof = await readProfileScope(supabase, user.id);
    const orgId = prof.org_id;
    const supervisor =
      Boolean(orgId && UUID.test(orgId)) &&
      prof.supervisor &&
      isAdminConfigured();
    if (!supervisor)
      return { updated: 0, error: "Only managers and above can archive leads." };

    const admin = createAdminClient();
    const stamp = archived ? new Date().toISOString() : null;
    const updatedIds: string[] = [];
    const CHUNK = 100; // keep each request URL small — see deleteLeads
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { data, error } = await admin
        .from("leads")
        .update({ archived_at: stamp })
        .in("id", batch)
        // Admin client bypasses RLS — scope to the supervisor's org (plus their
        // own pre-org rows) in code, exactly like deleteLeads' supervisor branch.
        .or(`org_id.eq.${orgId},owner_id.eq.${user.id}`)
        .select("id");
      if (error) return { updated: updatedIds.length, error: error.message };
      for (const r of (data ?? []) as Row[]) updatedIds.push(String(r.id));
    }

    // Timeline entry per lead — archiving is a field change on archived_at, so
    // it uses that existing event kind rather than growing the closed set.
    // Fire-and-forget by contract; only the rows that actually changed are logged.
    if (updatedIds.length) {
      logLeadEventBulk({
        leadIds: updatedIds,
        orgId,
        actorId: user.id,
        kind: "field_change",
        payload: {
          field: "archived_at",
          action: archived ? "archived" : "unarchived",
        },
      });
    }

    return { updated: updatedIds.length };
  } catch (e) {
    return { updated: 0, error: e instanceof Error ? e.message : "Archive failed." };
  }
}
