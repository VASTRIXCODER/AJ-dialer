import "server-only";

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

export async function getScope(): Promise<Scope | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .maybeSingle();
  const orgId = prof?.org_id ? String(prof.org_id) : null;
  const supervisor = Boolean(
    orgId && ["owner", "admin", "manager"].includes(String(prof?.role ?? "rep")),
  );
  return { userId: user.id, orgId, supervisor };
}

/** May this actor read/modify a row owned by `rowOwnerId` in org `rowOrgId`? */
export function canActOn(
  scope: Scope,
  rowOwnerId: string | null,
  rowOrgId: string | null,
): boolean {
  if (rowOwnerId && rowOwnerId === scope.userId) return true;
  if (scope.supervisor && scope.orgId && rowOrgId && rowOrgId === scope.orgId) return true;
  return false;
}
