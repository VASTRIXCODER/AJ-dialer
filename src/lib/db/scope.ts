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

/**
 * Raised when a read that decides WHO is asking, or HOW MUCH they may see,
 * could not be completed.
 *
 * Neither answer is safe to guess. "Not a supervisor" silently shrinks a
 * manager's world to their own uploads — a small, plausible, wrong book.
 * "Supervisor" hands a rep the whole organization. Callers that already report
 * an error message need no change; read paths rethrow this past their
 * `return []` so a failure reaches the error boundary instead of the user.
 */
export class ScopeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeUnavailableError";
  }
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
  let supervisor = false;
  try {
    supervisor = await resolveSupervisor(supabase, user.id, orgId, prof?.role);
  } catch {
    // Null is the handled path for every caller of getScope; guessing which
    // way to fail is not.
    return null;
  }
  return { userId: user.id, orgId, supervisor };
});

/**
 * Is this person a supervisor IN THE ORG THEY ARE CURRENTLY IN?
 *
 * `profiles.role` is a denormalized copy, and it drifts three ways:
 *
 *   · it has a column default of 'manager', so a row nobody ever set reads as
 *     a supervisor
 *   · `switchOrg` moves `profiles.org_id` and never touches `profiles.role`,
 *     so the role from the PREVIOUS workspace follows the user into the next
 *     one
 *   · the roster edits `organization_members.role`; the copy is not updated
 *
 * Measured in production while writing this: of eight profiles whose two roles
 * disagree, one is `rep` in the members table and `admin` on the profile — so
 * this function returned true, and roughly twenty db modules then handed that
 * person their whole organization's book. Two more disagree in the opposite
 * direction.
 *
 * The membership row for the active org is the authority (it is what
 * `getViewer()` and every permission check already use). The profile role is
 * consulted ONLY when no membership row exists, which is the same resilience
 * bridge `getActiveMembership` documents — a profile placed in an org by the
 * superadmin console, or by the backfill that predates the members table.
 *
 * THROWS when the membership could not be read: not "not a supervisor", which
 * would silently shrink a manager's world, and not "supervisor", which would
 * widen a rep's.
 *
 * Every db module that scopes a read by role must call this rather than test
 * `profiles.role` itself — twenty-one sites across seven files used to, which
 * is why one stale column could quietly widen twenty of them at once.
 */
export async function resolveSupervisor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  orgId: string | null,
  profileRole: unknown,
): Promise<boolean> {
  // Supervision is a property of a membership in an org. No org, no org to
  // supervise — this is not a failure, and it must not consult the profile
  // role, which may be left over from a workspace this person has since left.
  if (!orgId) return false;
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    throw new ScopeUnavailableError(
      "Couldn't confirm your role in this workspace, so we can't tell which records to show you.",
    );
  }
  if (data) return isSupervisorRole(data.role);
  // No membership row: the same resilience bridge getActiveMembership
  // documents — a profile placed in an org by the superadmin console, or by
  // the backfill that predates the members table.
  return isSupervisorRole(profileRole);
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

/** The shape every role-scoped read makes its decision from. */
export type ProfileScope = {
  org_id: string | null;
  role: unknown;
  disabled: boolean;
  /**
   * Resolved from the membership row for the ACTIVE org, never from
   * `profiles.role` — see resolveSupervisor. False whenever there is no org.
   */
  supervisor: boolean;
};

/**
 * Who is asking, and how much are they allowed to see.
 *
 * Every role-scoped read and write branches on this one row: `org_id` picks the
 * workspace, `role` picks between "your own uploads" and "the whole book".
 * Read unchecked — which all twelve call sites did — a failure resolves to
 * `null`, which is silently the REP answer. A supervisor was then shown the
 * handful of leads they had personally uploaded, correctly formatted, with a
 * total that agreed, and nothing anywhere said the workspace filter had been
 * dropped. Refusing is the only answer that can't be mistaken for a book.
 */
export async function readProfileScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  columns = "org_id, role",
): Promise<ProfileScope> {
  const { data, error } = await supabase
    .from("profiles")
    .select(columns)
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new ScopeUnavailableError(
      "Couldn't work out which workspace you're in, so we can't show the right records.",
    );
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const orgId = row.org_id ? String(row.org_id) : null;
  return {
    org_id: orgId,
    role: row.role,
    disabled: Boolean(row.disabled),
    // profiles.role is a denormalized copy that drifts — it has a column
    // default of 'manager', and switchOrg moves org_id without touching it.
    // The membership row for the ACTIVE org is the authority.
    supervisor: await resolveSupervisor(supabase, userId, orgId, row.role),
  };
}
