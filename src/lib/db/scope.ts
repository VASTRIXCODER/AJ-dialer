import "server-only";

import { cache } from "react";
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
  const { data: prof, error } = await supabase
    .from("profiles")
    .select("org_id, role, disabled")
    .eq("id", user.id)
    .maybeSingle();
  // A read that FAILED cannot clear anybody. This destructured `data` alone, so
  // a resolved error left `prof` undefined, `prof?.disabled` was falsy, and the
  // suspension backstop below simply did not fire — while the function went on
  // to return a usable scope built from the same undefined row.
  //
  // Null is the handled path for every caller, so refusing here is recoverable;
  // handing a suspended account a scope is not.
  if (error) return null;
  // Suspension backstop, CENTRAL: most scope consumers go on to read through
  // the service-role client, which bypasses the RLS `app_is_active()` gate a
  // suspended account otherwise hits. A disabled profile gets no scope at all.
  if (prof?.disabled) return null;
  const orgId = prof?.org_id ? String(prof.org_id) : null;
  const supervisor = Boolean(
    orgId && ["owner", "admin", "manager"].includes(String(prof?.role ?? "rep")),
  );
  return { userId: user.id, orgId, supervisor };
});

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
