import "server-only";

import type { User } from "@supabase/supabase-js";
import { getUser } from "../auth";
import { writeAudit } from "../db/app-control";
import {
  type OrgRole,
  type Permission,
  ROLE_RANK,
  can,
  effectivePermissions,
  isOrgRole,
} from "../permissions";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import {
  type OrgBlueprint,
  type OrgSettings,
  DEFAULT_ORG_SETTINGS,
  mergeSettings,
} from "./settings";

// Re-exported so existing importers keep working from "@/lib/org/membership".
export type { OrgSettings, OrgBlueprint } from "./settings";
export { DEFAULT_ORG_SETTINGS } from "./settings";

// ─────────────────────────────────────────────────────────────────────────────
// Organization membership engine. Reads scoped to the caller use the RLS client;
// cross-member reads and every mutation use the service-role client AFTER the
// caller is authenticated and their role is checked here, in application code.
// Everything degrades gracefully when Supabase / the service role is absent.
// ─────────────────────────────────────────────────────────────────────────────

const NEEDS_SERVICE =
  "Add SUPABASE_SERVICE_ROLE_KEY to enable organization management.";

export type MemberStatus = "pending" | "active" | "rejected" | "removed";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  industry: string;
  status: "active" | "suspended";
  joinCode: string;
  requireApproval: boolean;
  allowJoin: boolean;
  description: string;
  productName: string;
  tagline: string;
  website: string;
  logoUrl: string;
  brandColor: string;
  accentColor: string;
  timezone: string;
  dialerTemplate: string;
  defaultRole: OrgRole;
  ownerId: string | null;
  createdAt: string;
}

export interface OrgFull extends OrgSummary {
  settings: OrgSettings;
}

export interface Member {
  id: string;
  orgId: string;
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  permissions: Record<string, boolean>;
  status: MemberStatus;
  requestedAt: string;
  decidedAt: string | null;
  createdAt: string;
}

export interface Viewer {
  user: User | null;
  isDemo: boolean;
  displayName: string;
  email: string;
  org: OrgFull | null;
  role: OrgRole | null;
  permissions: Permission[];
  membershipStatus: "active" | "pending" | "none";
}

type Row = Record<string, unknown>;
type Result = { ok: boolean; error?: string };

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) ||
  `org-${Date.now().toString(36)}`;

const genJoinCode = () =>
  Array.from({ length: 7 }, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 32)),
  ).join("");

function mapOrg(o: Row): OrgFull {
  const role = String(o.default_role ?? "rep");
  return {
    id: String(o.id),
    name: String(o.name ?? "Organization"),
    slug: String(o.slug ?? ""),
    industry: String(o.industry ?? ""),
    status: (String(o.status ?? "active") as OrgSummary["status"]),
    joinCode: String(o.join_code ?? ""),
    requireApproval: o.require_approval !== false,
    allowJoin: o.allow_join !== false,
    description: String(o.description ?? ""),
    productName: String(o.product_name ?? ""),
    tagline: String(o.tagline ?? ""),
    website: String(o.website ?? ""),
    logoUrl: String(o.logo_url ?? ""),
    brandColor: String(o.brand_color ?? ""),
    accentColor: String(o.accent_color ?? ""),
    timezone: String(o.timezone ?? "America/Los_Angeles"),
    dialerTemplate: String(o.dialer_template ?? "general"),
    defaultRole: isOrgRole(role) ? role : "rep",
    ownerId: o.owner_id ? String(o.owner_id) : null,
    createdAt: String(o.created_at ?? ""),
    settings: mergeSettings(o.settings),
  };
}

function mapMember(m: Row): Member {
  const role = String(m.role ?? "rep");
  return {
    id: String(m.id),
    orgId: String(m.org_id),
    userId: String(m.user_id),
    email: String(m.email ?? ""),
    name: String(m.name ?? ""),
    role: isOrgRole(role) ? role : "rep",
    permissions: (m.permissions as Record<string, boolean>) ?? {},
    status: (String(m.status ?? "pending") as MemberStatus),
    requestedAt: String(m.requested_at ?? ""),
    decidedAt: m.decided_at ? String(m.decided_at) : null,
    createdAt: String(m.created_at ?? ""),
  };
}

// ── Demo viewer ──────────────────────────────────────────────────────────────
const DEMO_ORG: OrgFull = {
  id: "demo-sunrun",
  name: "Sunrun",
  slug: "sunrun",
  industry: "Residential Solar",
  status: "active",
  joinCode: "SUNRUN1",
  requireApproval: true,
  allowJoin: true,
  description: "Residential solar resolution calling.",
  productName: "Sunrun Resolution Dialer",
  tagline: "AI-powered solar resolution calling",
  website: "https://sunrun.com",
  logoUrl: "",
  brandColor: "",
  accentColor: "",
  timezone: "America/Los_Angeles",
  dialerTemplate: "solar",
  defaultRole: "rep",
  ownerId: "demo",
  createdAt: new Date().toISOString(),
  settings: DEFAULT_ORG_SETTINGS,
};

/** The full context for the current request: who, which org, what they can do. */
export async function getViewer(): Promise<Viewer> {
  // Demo mode (no Supabase): act as the owner of a demo Sunrun org so the whole
  // product — including Admin — is explorable without auth.
  if (!isSupabaseConfigured()) {
    return {
      user: null,
      isDemo: true,
      displayName: "Demo Owner",
      email: "owner@demo.local",
      org: DEMO_ORG,
      role: "owner",
      permissions: effectivePermissions("owner"),
      membershipStatus: "active",
    };
  }

  const user = await getUser();
  if (!user) {
    return {
      user: null,
      isDemo: false,
      displayName: "Account",
      email: "",
      org: null,
      role: null,
      permissions: [],
      membershipStatus: "none",
    };
  }

  const displayName =
    (user.user_metadata?.full_name as string) ||
    user.email?.split("@")[0] ||
    "Account";

  const membership = await getActiveMembership(user.id);
  if (!membership) {
    const pending = await getPendingMembership(user.id);
    return {
      user,
      isDemo: false,
      displayName,
      email: user.email ?? "",
      org: null,
      role: null,
      permissions: [],
      membershipStatus: pending ? "pending" : "none",
    };
  }

  const org = await getOrgById(membership.orgId);
  return {
    user,
    isDemo: false,
    displayName,
    email: user.email ?? "",
    org,
    role: membership.role,
    permissions: effectivePermissions(membership.role, membership.permissions),
    membershipStatus: "active",
  };
}

/** Does the current viewer hold a permission? (Demo = owner; reps = none.) */
export async function viewerCan(permission: Permission): Promise<boolean> {
  const viewer = await getViewer();
  return viewer.permissions.includes(permission);
}

/** Does the viewer hold ANY of the given permissions? */
export async function viewerCanAny(permissions: Permission[]): Promise<boolean> {
  const viewer = await getViewer();
  return permissions.some((p) => viewer.permissions.includes(p));
}

/** The viewer's active org id (for scoping monitor/reporting reads), or null. */
export async function viewerOrgId(): Promise<string | null> {
  const viewer = await getViewer();
  return viewer.org?.id ?? null;
}

// ── Reads (RLS-scoped to the caller) ─────────────────────────────────────────
/**
 * The caller's *active* membership — the org they've entered. The active org is
 * tracked on profiles.org_id (set when they enter/switch from the Hub), so a
 * user can belong to many orgs but work in one at a time.
 */
export async function getActiveMembership(userId: string): Promise<Member | null> {
  try {
    const supabase = await createClient();
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, full_name, role, org_id")
      .eq("id", userId)
      .maybeSingle();
    const activeOrgId = prof?.org_id ? String(prof.org_id) : null;
    if (!activeOrgId) return null; // no org entered → the Hub will prompt them

    const { data } = await supabase
      .from("organization_members")
      .select("*")
      .eq("user_id", userId)
      .eq("org_id", activeOrgId)
      .eq("status", "active")
      .maybeSingle();
    if (data) return mapMember(data as Row);

    // Resilience bridge: a profile assigned to an org (by the superadmin console,
    // or by the schema backfill before the members table existed) still counts.
    const role = isOrgRole(prof?.role) ? prof.role : "rep";
    return {
      id: `profile-${userId}`,
      orgId: activeOrgId,
      userId,
      email: "",
      name: String(prof?.full_name ?? ""),
      role,
      permissions: {},
      status: "active",
      requestedAt: "",
      decidedAt: null,
      createdAt: "",
    };
  } catch {
    return null;
  }
}

/** Every active org the caller belongs to (powers the Hub workspace switcher). */
export async function getMyMemberships(
  userId: string,
): Promise<{ org: OrgSummary; role: OrgRole; isActive: boolean }[]> {
  try {
    const supabase = await createClient();
    const [{ data: rows }, { data: prof }] = await Promise.all([
      supabase
        .from("organization_members")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: true }),
      supabase.from("profiles").select("org_id").eq("id", userId).maybeSingle(),
    ]);
    const activeOrgId = prof?.org_id ? String(prof.org_id) : null;
    const members = ((rows ?? []) as Row[]).map(mapMember);

    // Bridge: ensure the profile's active org appears even without a member row.
    if (activeOrgId && !members.some((m) => m.orgId === activeOrgId)) {
      members.push({
        id: `profile-${userId}`,
        orgId: activeOrgId,
        userId,
        email: "",
        name: "",
        role: "rep",
        permissions: {},
        status: "active",
        requestedAt: "",
        decidedAt: null,
        createdAt: "",
      });
    }

    const orgs = await Promise.all(members.map((m) => getOrgById(m.orgId)));
    const out: { org: OrgSummary; role: OrgRole; isActive: boolean }[] = [];
    members.forEach((m, i) => {
      const org = orgs[i];
      if (org) out.push({ org, role: m.role, isActive: m.orgId === activeOrgId });
    });
    return out;
  } catch {
    return [];
  }
}

/** Every pending join request the caller has made (with org names). */
export async function getMyPendingRequests(
  userId: string,
): Promise<{ orgName: string; orgId: string; requireApproval: boolean }[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organization_members")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("requested_at", { ascending: false });
    const members = ((data ?? []) as Row[]).map(mapMember);
    const orgs = await Promise.all(members.map((m) => getOrgById(m.orgId)));
    return members.map((m, i) => ({
      orgId: m.orgId,
      orgName: orgs[i]?.name ?? "Organization",
      requireApproval: orgs[i]?.requireApproval ?? true,
    }));
  } catch {
    return [];
  }
}

/** Enter / switch to an org the caller is an active member of. */
export async function switchActiveOrg(orgId: string): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  try {
    const supabase = await createClient();
    // Confirm an active membership (or the resilience bridge) before entering.
    const { data: member } = await supabase
      .from("organization_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!prof || String(prof.org_id) !== orgId)
        return { ok: false, error: "You’re not a member of that organization." };
    }
    const writer = isAdminConfigured() ? createAdminClient() : supabase;
    const { error } = await writer
      .from("profiles")
      .update({ org_id: orgId })
      .eq("id", user.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Leave the active org (or clear the active selection back to the Hub). */
export async function leaveActiveOrg(): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!isAdminConfigured()) return { ok: false, error: NEEDS_SERVICE };
  try {
    const admin = createAdminClient();
    await admin.from("profiles").update({ org_id: null }).eq("id", user.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function getPendingMembership(
  userId: string,
): Promise<{ member: Member; org: OrgSummary | null } | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organization_members")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .maybeSingle();
    if (!data) return null;
    const member = mapMember(data as Row);
    const org = await getOrgById(member.orgId);
    return { member, org };
  } catch {
    return null;
  }
}

export async function getOrgById(id: string): Promise<OrgFull | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ? mapOrg(data as Row) : null;
  } catch {
    return null;
  }
}

/**
 * Every active org with full settings — admin-scoped (no user session). Used by
 * the cron auto-dialer to find orgs whose automation window is currently open.
 */
export async function listActiveOrgsWithSettings(): Promise<OrgFull[]> {
  if (!isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("organizations")
      .select("*")
      .eq("status", "active");
    return ((data ?? []) as Row[]).map(mapOrg);
  } catch {
    return [];
  }
}

/** Public directory of joinable orgs (name + member count) for onboarding. */
export async function listJoinableOrgs(): Promise<
  { id: string; name: string; industry: string; slug: string; requireApproval: boolean }[]
> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organizations")
      .select("id,name,industry,slug,allow_join,require_approval,status")
      .eq("status", "active")
      .order("name", { ascending: true });
    return ((data ?? []) as Row[])
      .filter((o) => o.allow_join !== false)
      .map((o) => ({
        id: String(o.id),
        name: String(o.name ?? ""),
        industry: String(o.industry ?? ""),
        slug: String(o.slug ?? ""),
        requireApproval: o.require_approval !== false,
      }));
  } catch {
    return [];
  }
}

/** Every member (active + pending) of an org — cross-member, service role. */
export async function listMembers(orgId: string): Promise<Member[]> {
  try {
    const client = isAdminConfigured() ? createAdminClient() : await createClient();
    const { data } = await client
      .from("organization_members")
      .select("*")
      .eq("org_id", orgId)
      .neq("status", "removed")
      .order("created_at", { ascending: true });
    return ((data ?? []) as Row[]).map(mapMember);
  } catch {
    return [];
  }
}

// ── Onboarding mutations ─────────────────────────────────────────────────────
export async function joinByCode(
  code: string,
): Promise<{ ok: boolean; error?: string; status?: MemberStatus; orgName?: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!isAdminConfigured()) return { ok: false, error: NEEDS_SERVICE };
  try {
    const admin = createAdminClient();
    const normalized = code.trim().toUpperCase();
    const { data: org } = await admin
      .from("organizations")
      .select("*")
      .eq("join_code", normalized)
      .maybeSingle();
    if (!org) return { ok: false, error: "That join code didn’t match any organization." };
    if (org.allow_join === false)
      return { ok: false, error: "This organization isn’t accepting new members." };
    if (org.status === "suspended")
      return { ok: false, error: "This organization is currently suspended." };

    // Already a member?
    const { data: existing } = await admin
      .from("organization_members")
      .select("id,status")
      .eq("org_id", org.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing?.status === "active")
      return { ok: false, error: "You’re already a member of this organization." };

    const autoApprove = org.require_approval === false;
    const status: MemberStatus = autoApprove ? "active" : "pending";
    const role = isOrgRole(org.default_role) ? org.default_role : "rep";
    const name =
      (user.user_metadata?.full_name as string) || user.email?.split("@")[0] || "";

    const payload = {
      org_id: org.id,
      user_id: user.id,
      email: user.email ?? "",
      name,
      role,
      status,
      requested_at: new Date().toISOString(),
      decided_at: autoApprove ? new Date().toISOString() : null,
    };
    const { error } = existing
      ? await admin.from("organization_members").update(payload).eq("id", existing.id)
      : await admin.from("organization_members").insert(payload);
    if (error) return { ok: false, error: error.message };

    if (autoApprove) {
      await admin.from("profiles").update({ org_id: org.id, role }).eq("id", user.id);
    }
    return { ok: true, status, orgName: String(org.name ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to join." };
  }
}

export async function createOrganization(input: {
  name: string;
  industry?: string;
  template?: string;
  blueprint?: OrgBlueprint;
}): Promise<{ ok: boolean; error?: string; orgId?: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!isAdminConfigured()) return { ok: false, error: NEEDS_SERVICE };
  const bp = input.blueprint;
  const name = (bp?.name || input.name).trim();
  if (!name) return { ok: false, error: "Organization name is required." };
  try {
    const admin = createAdminClient();
    // Unique slug.
    let slug = slugify(name);
    const { data: clash } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

    const insert: Record<string, unknown> = {
      name,
      slug,
      industry: (bp?.industry ?? input.industry ?? "").trim(),
      dialer_template: bp?.template || input.template || "general",
      join_code: genJoinCode(),
      owner_id: user.id,
      require_approval: bp ? bp.requireApproval : true,
      allow_join: true,
    };
    if (bp) {
      // Apply the full white-label blueprint the AI produced.
      insert.product_name = bp.productName ?? "";
      insert.tagline = bp.tagline ?? "";
      insert.description = bp.description ?? "";
      insert.brand_color = bp.brandColor ?? "";
      insert.accent_color = bp.accentColor ?? "";
      insert.default_role = bp.defaultRole ?? "rep";
      insert.settings = mergeSettings(bp.settings);
    }

    const { data: org, error } = await admin
      .from("organizations")
      .insert(insert)
      .select("id")
      .single();
    if (error || !org) {
      return {
        ok: false,
        error: /relation .*organizations.* does not exist/i.test(error?.message ?? "")
          ? "Run the latest supabase/schema.sql first."
          : (error?.message ?? "Could not create organization."),
      };
    }

    const fullName =
      (user.user_metadata?.full_name as string) || user.email?.split("@")[0] || "Owner";
    await admin.from("organization_members").insert({
      org_id: org.id,
      user_id: user.id,
      email: user.email ?? "",
      name: fullName,
      role: "owner",
      status: "active",
      decided_at: new Date().toISOString(),
      decided_by: user.id,
    });
    await admin
      .from("profiles")
      .update({ org_id: org.id, role: "owner" })
      .eq("id", user.id);
    return { ok: true, orgId: String(org.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create." };
  }
}

// ── Management mutations (permission + rank enforced) ─────────────────────────

/** Load the actor's active membership and confirm a permission; returns it. */
async function authorize(
  permission: Permission,
): Promise<{ ok: true; actor: Member } | { ok: false; error: string; status: number }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in first.", status: 401 };
  const actor = await getActiveMembership(user.id);
  if (!actor) return { ok: false, error: "You’re not in an organization.", status: 403 };
  if (!can(actor.role, permission, actor.permissions))
    return { ok: false, error: "You don’t have permission to do that.", status: 403 };
  if (!isAdminConfigured()) return { ok: false, error: NEEDS_SERVICE, status: 400 };
  return { ok: true, actor };
}

async function loadMember(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data } = await admin
    .from("organization_members")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ? mapMember(data as Row) : null;
}

export async function decideMember(
  memberId: string,
  decision: "approve" | "reject",
  role?: OrgRole,
): Promise<Result> {
  const auth = await authorize("members.approve");
  if (!auth.ok) return { ok: false, error: auth.error };
  const admin = createAdminClient();
  const target = await loadMember(admin, memberId);
  if (!target || target.orgId !== auth.actor.orgId)
    return { ok: false, error: "Member not found." };
  if (target.status !== "pending")
    return { ok: false, error: "That request was already decided." };

  if (decision === "approve") {
    // Classify the joiner on approval (defaults to their requested role, usually
    // "rep"). You can only assign a role strictly below your own, never owner.
    let assigned: OrgRole = target.role;
    if (role && role !== target.role) {
      if (role === "owner")
        return { ok: false, error: "Ownership is transferred separately." };
      if (ROLE_RANK[role] > ROLE_RANK[auth.actor.role])
        return { ok: false, error: "You can’t assign a role above your own." };
      assigned = role;
    }
    const { error } = await admin
      .from("organization_members")
      .update({
        status: "active",
        role: assigned,
        decided_at: new Date().toISOString(),
        decided_by: auth.actor.userId,
      })
      .eq("id", memberId);
    if (error) return { ok: false, error: error.message };
    await admin
      .from("profiles")
      .update({ org_id: target.orgId, role: assigned })
      .eq("id", target.userId);
    await writeAudit({
      action: "member.approve",
      actorId: auth.actor.userId,
      targetId: target.userId,
      targetKind: "member",
      orgId: target.orgId,
      detail: { role: assigned },
    });
    return { ok: true };
  }

  const { error } = await admin
    .from("organization_members")
    .update({
      status: "rejected",
      decided_at: new Date().toISOString(),
      decided_by: auth.actor.userId,
    })
    .eq("id", memberId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setMemberRole(memberId: string, role: OrgRole): Promise<Result> {
  const auth = await authorize("members.role");
  if (!auth.ok) return { ok: false, error: auth.error };
  if (role === "owner") return { ok: false, error: "Ownership is transferred separately." };
  const admin = createAdminClient();
  const target = await loadMember(admin, memberId);
  if (!target || target.orgId !== auth.actor.orgId)
    return { ok: false, error: "Member not found." };
  if (target.role === "owner")
    return { ok: false, error: "You can’t change the owner’s role." };
  if (target.userId === auth.actor.userId)
    return { ok: false, error: "You can’t change your own role." };
  // Block managing someone who outranks you; same-rank is allowed so a manager
  // can promote/demote another manager.
  if (ROLE_RANK[target.role] > ROLE_RANK[auth.actor.role])
    return { ok: false, error: "You can’t manage someone above your role." };
  // Block assigning a role strictly above your own (e.g. manager can’t mint admins).
  if (ROLE_RANK[role] > ROLE_RANK[auth.actor.role])
    return { ok: false, error: "You can’t assign a role above your own." };

  const { error } = await admin
    .from("organization_members")
    .update({ role })
    .eq("id", memberId);
  if (error) return { ok: false, error: error.message };
  if (target.status === "active")
    await admin.from("profiles").update({ role }).eq("id", target.userId);
  await writeAudit({
    action: "member.role",
    actorId: auth.actor.userId,
    targetId: target.userId,
    targetKind: "member",
    orgId: target.orgId,
    detail: { role },
  });
  return { ok: true };
}

export async function setMemberPermissions(
  memberId: string,
  permissions: Record<string, boolean>,
): Promise<Result> {
  const auth = await authorize("members.role");
  if (!auth.ok) return { ok: false, error: auth.error };
  const admin = createAdminClient();
  const target = await loadMember(admin, memberId);
  if (!target || target.orgId !== auth.actor.orgId)
    return { ok: false, error: "Member not found." };
  if (target.role === "owner")
    return { ok: false, error: "The owner’s permissions can’t be overridden." };
  if (!strictlyAbove(auth.actor, target))
    return { ok: false, error: "You can’t manage someone at or above your role." };
  const { error } = await admin
    .from("organization_members")
    .update({ permissions })
    .eq("id", memberId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeMember(memberId: string): Promise<Result> {
  const auth = await authorize("members.remove");
  if (!auth.ok) return { ok: false, error: auth.error };
  const admin = createAdminClient();
  const target = await loadMember(admin, memberId);
  if (!target || target.orgId !== auth.actor.orgId)
    return { ok: false, error: "Member not found." };
  if (target.role === "owner") return { ok: false, error: "You can’t remove the owner." };
  if (target.userId === auth.actor.userId)
    return { ok: false, error: "Use “leave organization” to remove yourself." };
  if (!strictlyAbove(auth.actor, target))
    return { ok: false, error: "You can’t remove someone at or above your role." };

  const { error } = await admin
    .from("organization_members")
    .update({ status: "removed", decided_at: new Date().toISOString() })
    .eq("id", memberId);
  if (error) return { ok: false, error: error.message };
  // Send them back to onboarding.
  await admin.from("profiles").update({ org_id: null }).eq("id", target.userId);
  await writeAudit({
    action: "member.remove",
    actorId: auth.actor.userId,
    targetId: target.userId,
    targetKind: "member",
    orgId: target.orgId,
  });
  return { ok: true };
}

function strictlyAbove(actor: Member, target: Member): boolean {
  return ROLE_RANK[actor.role] > ROLE_RANK[target.role];
}

/**
 * Transfer ownership of the org to another active member. Owner-only. The new
 * owner is promoted to "owner" and the previous owner is demoted to "admin"
 * (so they keep management access). Updates memberships, the org's owner_id, and
 * both denormalized profile roles, then audits it.
 */
export async function transferOwnership(memberId: string): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const actor = await getActiveMembership(user.id);
  if (!actor) return { ok: false, error: "You’re not in an organization." };
  if (actor.role !== "owner")
    return { ok: false, error: "Only the current owner can transfer ownership." };
  if (!isAdminConfigured()) return { ok: false, error: NEEDS_SERVICE };

  const admin = createAdminClient();
  const target = await loadMember(admin, memberId);
  if (!target || target.orgId !== actor.orgId)
    return { ok: false, error: "Member not found." };
  if (target.status !== "active")
    return { ok: false, error: "You can only transfer ownership to an active member." };
  if (target.userId === actor.userId)
    return { ok: false, error: "You already own this organization." };

  const now = new Date().toISOString();
  // Promote the target to owner.
  const promote = await admin
    .from("organization_members")
    .update({ role: "owner", decided_at: now, decided_by: actor.userId })
    .eq("id", target.id);
  if (promote.error) return { ok: false, error: promote.error.message };
  // Demote the current owner to admin.
  await admin
    .from("organization_members")
    .update({ role: "admin" })
    .eq("org_id", actor.orgId)
    .eq("user_id", actor.userId);
  // Point the org + both denormalized profile roles at the new structure.
  await admin.from("organizations").update({ owner_id: target.userId }).eq("id", actor.orgId);
  await admin.from("profiles").update({ role: "owner" }).eq("id", target.userId);
  await admin.from("profiles").update({ role: "admin" }).eq("id", actor.userId);

  await writeAudit({
    action: "member.transfer_ownership",
    actorId: actor.userId,
    targetId: target.userId,
    targetKind: "member",
    orgId: actor.orgId,
  });
  return { ok: true };
}

// ── Organization customization ───────────────────────────────────────────────
export interface OrgUpdate {
  name?: string;
  industry?: string;
  description?: string;
  productName?: string;
  tagline?: string;
  website?: string;
  logoUrl?: string;
  brandColor?: string;
  accentColor?: string;
  timezone?: string;
  dialerTemplate?: string;
  defaultRole?: OrgRole;
  requireApproval?: boolean;
  allowJoin?: boolean;
  settings?: Partial<OrgSettings>;
}

const COLUMN_MAP: Record<string, string> = {
  name: "name",
  industry: "industry",
  description: "description",
  productName: "product_name",
  tagline: "tagline",
  website: "website",
  logoUrl: "logo_url",
  brandColor: "brand_color",
  accentColor: "accent_color",
  timezone: "timezone",
  dialerTemplate: "dialer_template",
  defaultRole: "default_role",
  requireApproval: "require_approval",
  allowJoin: "allow_join",
};

export async function updateOrganizationSettings(patch: OrgUpdate): Promise<Result> {
  const auth = await authorize("org.edit");
  if (!auth.ok) return { ok: false, error: auth.error };
  const admin = createAdminClient();
  const fields: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) fields[column] = value;
  }
  if (patch.settings) {
    const current = await getOrgById(auth.actor.orgId);
    fields.settings = {
      ...(current?.settings ?? DEFAULT_ORG_SETTINGS),
      ...patch.settings,
    };
  }
  if (Object.keys(fields).length === 0) return { ok: true };
  const { error } = await admin
    .from("organizations")
    .update(fields)
    .eq("id", auth.actor.orgId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function rotateJoinCode(): Promise<{ ok: boolean; error?: string; code?: string }> {
  const auth = await authorize("org.joincode");
  if (!auth.ok) return { ok: false, error: auth.error };
  const admin = createAdminClient();
  const code = genJoinCode();
  const { error } = await admin
    .from("organizations")
    .update({ join_code: code })
    .eq("id", auth.actor.orgId);
  return error ? { ok: false, error: error.message } : { ok: true, code };
}

export async function deleteOrganization(): Promise<Result> {
  const auth = await authorize("org.delete");
  if (!auth.ok) return { ok: false, error: auth.error };
  const admin = createAdminClient();
  await admin.from("profiles").update({ org_id: null }).eq("org_id", auth.actor.orgId);
  const { error } = await admin
    .from("organizations")
    .delete()
    .eq("id", auth.actor.orgId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Companies (teams) within the org ─────────────────────────────────────────
export interface OrgCompany {
  id: string;
  name: string;
  createdAt: string;
}

export async function listOrgCompanies(orgId: string): Promise<OrgCompany[]> {
  try {
    const client = isAdminConfigured() ? createAdminClient() : await createClient();
    const { data } = await client
      .from("companies")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });
    return ((data ?? []) as Row[]).map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ""),
      createdAt: String(c.created_at ?? ""),
    }));
  } catch {
    return [];
  }
}

export async function createOrgCompany(name: string): Promise<Result> {
  const auth = await authorize("companies.manage");
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!name.trim()) return { ok: false, error: "Company name is required." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("companies")
    .insert({ org_id: auth.actor.orgId, name: name.trim() });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteOrgCompany(id: string): Promise<Result> {
  const auth = await authorize("companies.manage");
  if (!auth.ok) return { ok: false, error: auth.error };
  const admin = createAdminClient();
  const { error } = await admin
    .from("companies")
    .delete()
    .eq("id", id)
    .eq("org_id", auth.actor.orgId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
