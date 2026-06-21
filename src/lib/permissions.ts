// ─────────────────────────────────────────────────────────────────────────────
// Role hierarchy & granular permissions for organizations.
//
// Hierarchy (high → low):  owner > admin > manager > rep
// The global superadmin (separate /console) sits above all of this.
//
// Each role maps to a default permission set; individual members can be granted
// or revoked specific permissions via per-member overrides (the `permissions`
// JSONB on organization_members). This module is pure data + helpers so it can be
// imported from both Server and Client Components.
// ─────────────────────────────────────────────────────────────────────────────

export const ORG_ROLES = ["owner", "admin", "manager", "rep"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Higher rank ⇒ more authority. Used to stop people managing peers/superiors. */
export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 3,
  admin: 2,
  manager: 1,
  rep: 0,
};

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  rep: "Rep",
};

export const ROLE_DESCRIPTION: Record<OrgRole, string> = {
  owner: "Full control of the organization, including deletion & ownership.",
  admin: "Manage members, customization, companies & integrations.",
  manager: "Approve members, oversee the floor & view reports.",
  rep: "Dial, work leads, and manage their own appointments.",
};

export const PERMISSIONS = [
  "admin.access", // can open the Admin section at all
  "members.view",
  "members.approve",
  "members.invite",
  "members.role",
  "members.remove",
  "org.edit", // identity, branding, dialing, AI, compliance settings
  "org.joincode", // view & rotate the join code
  "org.delete",
  "companies.manage",
  "reports.view",
  "leads.import",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "org.delete"),
  manager: [
    "admin.access",
    "members.view",
    "members.approve",
    "members.invite",
    "members.role",
    "reports.view",
    "leads.import",
    "companies.manage",
  ],
  rep: [],
};

export const PERMISSION_LABEL: Record<Permission, string> = {
  "admin.access": "Access the Admin section",
  "members.view": "View members & requests",
  "members.approve": "Approve / reject join requests",
  "members.invite": "Invite new members",
  "members.role": "Change member roles & permissions",
  "members.remove": "Remove members",
  "org.edit": "Edit organization settings",
  "org.joincode": "View & rotate the join code",
  "org.delete": "Delete the organization",
  "companies.manage": "Manage companies / teams",
  "reports.view": "View reports & analytics",
  "leads.import": "Import leads",
};

export function rolePermissions(role: OrgRole | null | undefined): Permission[] {
  return role ? (ROLE_PERMISSIONS[role] ?? []) : [];
}

/**
 * Effective permission check: a per-member override (true/false) always wins,
 * otherwise fall back to the role's defaults.
 */
export function can(
  role: OrgRole | null | undefined,
  permission: Permission,
  overrides?: Record<string, boolean> | null,
): boolean {
  if (overrides && permission in overrides) return Boolean(overrides[permission]);
  return rolePermissions(role).includes(permission);
}

/** The full effective permission set for a role + overrides (for the client). */
export function effectivePermissions(
  role: OrgRole | null | undefined,
  overrides?: Record<string, boolean> | null,
): Permission[] {
  return ALL.filter((p) => can(role, p, overrides));
}

/** Strictly more authority than `b`. */
export function outranks(a: OrgRole, b: OrgRole): boolean {
  return ROLE_RANK[a] > ROLE_RANK[b];
}

/** At least as much authority as `b`. */
export function atLeast(a: OrgRole, b: OrgRole): boolean {
  return ROLE_RANK[a] >= ROLE_RANK[b];
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

/** Roles `actor` is allowed to assign to others (never at/above themselves, and
 *  only the owner can mint admins; nobody assigns "owner" through the UI). */
export function assignableRoles(actor: OrgRole): OrgRole[] {
  return ORG_ROLES.filter(
    (r) => r !== "owner" && ROLE_RANK[r] < ROLE_RANK[actor],
  );
}
