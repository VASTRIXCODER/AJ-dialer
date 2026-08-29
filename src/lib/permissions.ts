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
  "leads.export", // pull the book out as a file (bulk-data action, manager+ by default)
  "leads.reverseSearch", // skip-trace a lead's name/address for a phone number
  "assignments.manage", // allocate lead assignments & run the Assignment Center — manager+
  "dialer.ai", // launch AI agent calls (reps are manual-only by default)
  "monitor.view", // open the Live Monitor (see in-progress AI + rep calls) — manager+ by default
  "monitor.listen", // listen to live audio of in-progress calls — manager+ by default
  "monitor.intervene", // take over / transfer / end a live call
  "monitor.roster", // view the live team presence roster — manager+
  "appointments.view", // open the appointments calendar
  "appointments.manage", // create, reschedule, approve & cancel appointments
  "appointments.team", // see & manage the WHOLE team's calendar, not just your own — manager+
  "crm.view", // open the CRM workspace (pipeline board, shared queue, audiences)
  "work.claim", // take unowned work off the shared queue — every role, or the queue is scenery
  "crm.pipeline.manage", // move a record's stage BY HAND — manager+, see the note below
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
    "leads.export",
    "leads.reverseSearch",
    "assignments.manage",
    "companies.manage",
    "dialer.ai",
    "monitor.view",
    "monitor.listen",
    "monitor.intervene",
    "monitor.roster",
    "appointments.view",
    "appointments.manage",
    "appointments.team",
    "crm.view",
    "work.claim",
    "crm.pipeline.manage",
  ],
  // Reps dial and work leads. They get the MANUAL dialer; the AI dialer is gated
  // (managers+ only) unless the workspace is AI-only.
  //
  // Reps do NOT get monitor.view / monitor.listen by default (changed Phase 1):
  // those defaults let any rep silently listen to any teammate's live customer
  // call, while the monitor page's own copy claimed supervisors-only. Listening
  // is a supervisor capability; an org that wants a specific rep coaching along
  // can still grant it with a per-member override — overrides always win.
  //
  // They DO get appointments.view + .manage — a rep books their own account
  // reviews, so revoking these would break the dialer's own disposition flow.
  // What they don't get is `appointments.team`: a rep sees their own calendar,
  // a manager sees the floor's. Row-level access follows the permission (see
  // canActOnAppt in src/lib/db/appointments.ts), so a per-member override that
  // revokes `appointments.manage` genuinely locks that account out of every
  // calendar write — not just the buttons.
  //
  // Reps DO get crm.view + work.claim. The CRM's shared queue exists to hand
  // out work nobody owns yet; a queue only supervisors can claim from is a
  // report, not a queue.
  //
  // They do NOT get crm.pipeline.manage. Stage is derived from evidence — the
  // dispositions reps already file move it, through the same state machine,
  // with an event written. Hand-moving a stage writes the same row with no
  // evidence behind it, which would make opportunity_events describe a sales
  // process that didn't happen. A manager correcting a mis-staged record is a
  // deliberate, attributable exception; a rep tidying their board is not.
  rep: ["appointments.view", "appointments.manage", "crm.view", "work.claim"],
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
  "leads.export": "Export leads",
  "leads.reverseSearch": "Reverse-search a lead for a phone number",
  "assignments.manage": "Allocate & manage lead assignments",
  "dialer.ai": "Use the AI dialer",
  "monitor.view": "Open the Live Monitor",
  "monitor.listen": "Listen to live calls",
  "monitor.intervene": "Take over, transfer or end live calls",
  "monitor.roster": "View the live team roster (who's active, on what call)",
  "appointments.view": "View the appointments calendar",
  "appointments.manage": "Book, reschedule & cancel appointments",
  "appointments.team": "See & manage the whole team's calendar",
  "crm.view": "Open the CRM workspace",
  "work.claim": "Claim work from the shared queue",
  "crm.pipeline.manage": "Move records between pipeline stages by hand",
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

/** Roles `actor` is allowed to assign to others (never above themselves, and
 *  nobody assigns "owner" through the UI; managers/owners can assign up to
 *  their own rank so a manager can promote a rep to manager). */
export function assignableRoles(actor: OrgRole): OrgRole[] {
  return ORG_ROLES.filter(
    (r) => r !== "owner" && ROLE_RANK[r] <= ROLE_RANK[actor],
  );
}
