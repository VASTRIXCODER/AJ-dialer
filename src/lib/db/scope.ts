import "server-only";

import { cache } from "react";
import { isSupervisorRole } from "../permissions";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";

// ─────────────────────────────────────────────────────────────────────────────
// Request scope + row-level authorization shared by the pipeline surfaces.
// A supervisor (manager/admin/owner) may see and act on their whole org; a rep
// only on rows they own. Org-wide writes go through the service-role client AFTER
// canActOn() confirms the actor in application code (RLS would block them).
// ─────────────────────────────────────────────────────────────────────────────

export interface Scope {
  userId: string;
  orgId: string | null;
  supervisor: boolean;
}

// Request-scoped: the pipeline surfaces (leads, campaigns, dispositions, …) each
// call getScope() during one render — cache() collapses the repeated auth +
// profiles lookups to one.
export const getScope = cache(async (): Promise<Scope | null> => {
  // Demo mode: createServerClient THROWS on empty credentials ("Your project's
  // URL and Key are required"), so calling through would take down every page
  // that resolves a scope during render. No Supabase means no scope — every
  // caller already handles null.
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("org_id, role, disabled")
    .eq("id", user.id)
    .maybeSingle();
  // Suspension backstop, CENTRAL: most scope consumers go on to read through
  // the service-role client, which bypasses the RLS `app_is_active()` gate a
  // suspended account otherwise hits. A disabled profile gets no scope at all.
  if (prof?.disabled) return null;
  const orgId = prof?.org_id ? String(prof.org_id) : null;
  const supervisor = await resolveSupervisor(supabase, user.id, orgId, prof?.role);
  return { userId: user.id, orgId, supervisor };
});

/**
 * Is this person a supervisor IN THE ORG THEY ARE CURRENTLY IN?
 *
 * `profiles.role` is a denormalized copy of `organization_members.role`, and it
 * drifts three ways:
 *
 *   · it carried a column default of 'manager' while `handle_new_user` inserts
 *     only (id, full_name), so a row nobody ever set read as a supervisor
 *   · `switchOrg` moves `profiles.org_id` and never touches `profiles.role`, so
 *     the role from the PREVIOUS workspace follows the user into the next one
 *   · the roster edits `organization_members.role`; nothing writes the copy back
 *
 * Measured in production: profile 329a50a9-3c3c-438a-8f37-0b5c1a8b31e4 is `rep`
 * in the members table and `admin` on the profile, so this returned true and
 * every scoped read handed that person their whole organization's book —
 * 37,987 leads, every call record, every metric.
 *
 * The membership row for the ACTIVE org is the authority. It is what
 * `getViewer()` and every permission check already use; only these data-scope
 * reads had their own opinion.
 *
 * ON A FAILED READ this answers FALSE, deliberately. Both wrong answers are
 * bad, but they are not equally bad: "not a supervisor" shrinks a manager's
 * view to their own uploads, which is visible, recoverable and complained
 * about within a minute; "supervisor" hands a rep the whole book, which is
 * silent. Falling back to `profiles.role` here would just reinstate the bug.
 */
export async function resolveSupervisor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  orgId: string | null,
  profileRole: unknown,
): Promise<boolean> {
  // Supervision is a property of a membership in an org. No org, no org to
  // supervise — and the profile role must NOT be consulted here, because it may
  // be left over from a workspace this person has since left.
  if (!orgId) return false;
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    console.error("[scope] membership read failed; treating as non-supervisor:", error.message);
    return false;
  }
  if (data) return isSupervisorRole(data.role);
  // No membership row: the resilience bridge getActiveMembership documents — a
  // profile placed in an org by the superadmin console, or by the backfill that
  // predates the members table. Only here is the profile copy the best we have.
  return isSupervisorRole(profileRole);
}

/**
 * The scope a data module needs: which org, and how much of it.
 *
 * One function, because fifteen call sites each did their own `profiles` select
 * and then made this decision from the stale copy. `columns` widens the select
 * for the two callers that also need `disabled` or a display name.
 */
export async function readProfileScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  columns = "org_id, role",
): Promise<{ org_id: string | null; role: unknown; disabled: boolean; supervisor: boolean }> {
  const { data } = await supabase
    .from("profiles")
    .select(columns)
    .eq("id", userId)
    .maybeSingle();
  const row = (data ?? {}) as Record<string, unknown>;
  const orgId = row.org_id ? String(row.org_id) : null;
  return {
    org_id: orgId,
    role: row.role,
    disabled: Boolean(row.disabled),
    supervisor: await resolveSupervisor(supabase, userId, orgId, row.role),
  };
}

/** May this actor read/modify a row owned by `rowOwnerId` in org `rowOrgId`? */
export function canActOn(
  scope: Scope,
  rowOwnerId: string | null,
  rowOrgId: string | null,
): boolean {
  // A row stamped with a DIFFERENT org than the one the actor is currently
  // active in is never actionable — even if they happen to be its owner. Rows
  // don't follow a user across organizations just because the same account
  // created them; otherwise a user who leaves (or spins up a new) org keeps
  // reaching into the old one's data forever. Legacy rows with no org_id at
  // all fall through to the ownership check below unchanged.
  if (rowOrgId && rowOrgId !== scope.orgId) return false;
  if (rowOwnerId && rowOwnerId === scope.userId) return true;
  if (scope.supervisor && scope.orgId && rowOrgId && rowOrgId === scope.orgId) return true;
  return false;
}
