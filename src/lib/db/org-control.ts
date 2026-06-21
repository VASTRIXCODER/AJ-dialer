import "server-only";

import { mergeSettings } from "../org/settings";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Organization & company management for the superadmin console. Service-role
// only. Every function degrades gracefully if the schema/service role is absent.
// ─────────────────────────────────────────────────────────────────────────────

const NOT_READY = "Run the latest supabase/schema.sql to enable organizations.";

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  industry: string;
  status: "active" | "suspended";
  createdAt: string;
  companyCount: number;
  memberCount: number;
  pendingCount: number;
  joinCode: string;
  dialerTemplate: string;
  productName: string;
  brandColor: string;
  requireApproval: boolean;
  allowJoin: boolean;
}

export interface CompanyRow {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
}

export interface OrgMemberRow {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  requestedAt: string;
  createdAt: string;
}

export interface OrgDetail extends OrganizationRow {
  description: string;
  tagline: string;
  website: string;
  accentColor: string;
  defaultRole: string;
  timezone: string;
  settings: import("../org/settings").OrgSettings;
}

type Row = Record<string, unknown>;
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) ||
  `org-${Date.now().toString(36)}`;
const genJoinCode = () =>
  Array.from({ length: 7 }, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 32)),
  ).join("");

export async function listOrganizations(): Promise<OrganizationRow[]> {
  if (!isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const [orgsRes, companiesRes, membersRes, profilesRes] = await Promise.all([
      admin.from("organizations").select("*").order("created_at", { ascending: true }),
      admin.from("companies").select("id,org_id"),
      admin.from("organization_members").select("org_id,status"),
      admin.from("profiles").select("id,org_id"),
    ]);
    const companyCount = new Map<string, number>();
    for (const c of (companiesRes.data ?? []) as Row[]) {
      const k = String(c.org_id);
      companyCount.set(k, (companyCount.get(k) ?? 0) + 1);
    }
    // Prefer the membership table for counts; fall back to profiles.org_id.
    const memberCount = new Map<string, number>();
    const pendingCount = new Map<string, number>();
    const membersRows = (membersRes.data ?? []) as Row[];
    if (membersRows.length) {
      for (const m of membersRows) {
        const k = String(m.org_id);
        if (m.status === "active")
          memberCount.set(k, (memberCount.get(k) ?? 0) + 1);
        else if (m.status === "pending")
          pendingCount.set(k, (pendingCount.get(k) ?? 0) + 1);
      }
    } else {
      for (const p of (profilesRes.data ?? []) as Row[]) {
        if (p.org_id) {
          const k = String(p.org_id);
          memberCount.set(k, (memberCount.get(k) ?? 0) + 1);
        }
      }
    }
    return ((orgsRes.data ?? []) as Row[]).map((o) => mapOrgRow(o, {
      companyCount: companyCount.get(String(o.id)) ?? 0,
      memberCount: memberCount.get(String(o.id)) ?? 0,
      pendingCount: pendingCount.get(String(o.id)) ?? 0,
    }));
  } catch {
    return [];
  }
}

function mapOrgRow(
  o: Row,
  counts: { companyCount: number; memberCount: number; pendingCount: number },
): OrganizationRow {
  return {
    id: String(o.id),
    name: String(o.name ?? "Organization"),
    slug: String(o.slug ?? ""),
    industry: String(o.industry ?? ""),
    status: (String(o.status ?? "active") as OrganizationRow["status"]),
    createdAt: String(o.created_at ?? ""),
    joinCode: String(o.join_code ?? ""),
    dialerTemplate: String(o.dialer_template ?? "general"),
    productName: String(o.product_name ?? ""),
    brandColor: String(o.brand_color ?? ""),
    requireApproval: o.require_approval !== false,
    allowJoin: o.allow_join !== false,
    ...counts,
  };
}

export async function createOrganization(input: {
  name: string;
  industry?: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("organizations")
      .insert({
        name: input.name.trim(),
        slug: slugify(input.name),
        industry: input.industry?.trim() ?? "",
        join_code: genJoinCode(),
      })
      .select("id")
      .single();
    if (error) {
      return {
        ok: false,
        error: /relation .*organizations.* does not exist/i.test(error.message)
          ? NOT_READY
          : error.message,
      };
    }
    return { ok: true, id: String(data?.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

const ORG_COLUMN_MAP: Record<string, string> = {
  name: "name",
  industry: "industry",
  status: "status",
  description: "description",
  productName: "product_name",
  tagline: "tagline",
  website: "website",
  brandColor: "brand_color",
  accentColor: "accent_color",
  timezone: "timezone",
  dialerTemplate: "dialer_template",
  defaultRole: "default_role",
  requireApproval: "require_approval",
  allowJoin: "allow_join",
};

export async function updateOrganization(
  id: string,
  patch: Record<string, unknown> & { settings?: Record<string, unknown> },
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const fields: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(ORG_COLUMN_MAP)) {
      if (patch[key] !== undefined) fields[column] = patch[key];
    }
    if (patch.settings) {
      const { data: cur } = await admin
        .from("organizations")
        .select("settings")
        .eq("id", id)
        .maybeSingle();
      fields.settings = {
        ...((cur?.settings as Record<string, unknown>) ?? {}),
        ...patch.settings,
      };
    }
    if (Object.keys(fields).length === 0) return { ok: true };
    const { error } = await admin.from("organizations").update(fields).eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Full org detail for the superadmin drill-in view. */
export async function getOrganizationDetail(id: string): Promise<OrgDetail | null> {
  if (!isAdminConfigured()) return null;
  try {
    const admin = createAdminClient();
    const [{ data: o }, companies, membersRes] = await Promise.all([
      admin.from("organizations").select("*").eq("id", id).maybeSingle(),
      admin.from("companies").select("id").eq("org_id", id),
      admin.from("organization_members").select("status").eq("org_id", id),
    ]);
    if (!o) return null;
    const rows = (membersRes.data ?? []) as Row[];
    const memberCount = rows.filter((m) => m.status === "active").length;
    const pendingCount = rows.filter((m) => m.status === "pending").length;
    const base = mapOrgRow(o as Row, {
      companyCount: ((companies.data ?? []) as Row[]).length,
      memberCount,
      pendingCount,
    });
    return {
      ...base,
      description: String((o as Row).description ?? ""),
      tagline: String((o as Row).tagline ?? ""),
      website: String((o as Row).website ?? ""),
      accentColor: String((o as Row).accent_color ?? ""),
      defaultRole: String((o as Row).default_role ?? "rep"),
      timezone: String((o as Row).timezone ?? "America/Los_Angeles"),
      settings: mergeSettings((o as Row).settings),
    };
  } catch {
    return null;
  }
}

/** Members of one org (superadmin view). */
export async function listMembersForOrg(orgId: string): Promise<OrgMemberRow[]> {
  if (!isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("organization_members")
      .select("*")
      .eq("org_id", orgId)
      .neq("status", "removed")
      .order("created_at", { ascending: true });
    return ((data ?? []) as Row[]).map((m) => ({
      id: String(m.id),
      userId: String(m.user_id),
      email: String(m.email ?? ""),
      name: String(m.name ?? ""),
      role: String(m.role ?? "rep"),
      status: String(m.status ?? "pending"),
      requestedAt: String(m.requested_at ?? ""),
      createdAt: String(m.created_at ?? ""),
    }));
  } catch {
    return [];
  }
}

/** Approve / reject a pending member (superadmin override). */
export async function decideOrgMember(
  memberId: string,
  decision: "approve" | "reject",
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { data: m } = await admin
      .from("organization_members")
      .select("*")
      .eq("id", memberId)
      .maybeSingle();
    if (!m) return { ok: false, error: "Member not found." };
    const status = decision === "approve" ? "active" : "rejected";
    const { error } = await admin
      .from("organization_members")
      .update({ status, decided_at: new Date().toISOString() })
      .eq("id", memberId);
    if (error) return { ok: false, error: error.message };
    if (decision === "approve")
      await admin
        .from("profiles")
        .update({ org_id: m.org_id, role: m.role })
        .eq("id", m.user_id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function setOrgMemberRole(
  memberId: string,
  role: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { data: m } = await admin
      .from("organization_members")
      .select("user_id,status")
      .eq("id", memberId)
      .maybeSingle();
    const { error } = await admin
      .from("organization_members")
      .update({ role })
      .eq("id", memberId);
    if (error) return { ok: false, error: error.message };
    if (m?.status === "active")
      await admin.from("profiles").update({ role }).eq("id", m.user_id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function removeOrgMember(
  memberId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { data: m } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("id", memberId)
      .maybeSingle();
    const { error } = await admin
      .from("organization_members")
      .update({ status: "removed", decided_at: new Date().toISOString() })
      .eq("id", memberId);
    if (error) return { ok: false, error: error.message };
    if (m?.user_id)
      await admin.from("profiles").update({ org_id: null }).eq("id", m.user_id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Create an org from a full AI blueprint (superadmin console). */
export async function createOrganizationFromBlueprint(
  bp: import("../org/settings").OrgBlueprint,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  const name = bp.name?.trim();
  if (!name) return { ok: false, error: "Name required." };
  try {
    const admin = createAdminClient();
    let slug = slugify(name);
    const { data: clash } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await admin
      .from("organizations")
      .insert({
        name,
        slug,
        industry: bp.industry ?? "",
        dialer_template: bp.template || "general",
        product_name: bp.productName ?? "",
        tagline: bp.tagline ?? "",
        description: bp.description ?? "",
        brand_color: bp.brandColor ?? "",
        accent_color: bp.accentColor ?? "",
        default_role: bp.defaultRole ?? "rep",
        require_approval: bp.requireApproval ?? true,
        allow_join: true,
        join_code: genJoinCode(),
        settings: mergeSettings(bp.settings),
      })
      .select("id")
      .single();
    if (error) {
      return {
        ok: false,
        error: /relation .*organizations.* does not exist/i.test(error.message)
          ? NOT_READY
          : error.message,
      };
    }
    return { ok: true, id: String(data?.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function deleteOrganization(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("organizations").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function listCompanies(orgId: string): Promise<CompanyRow[]> {
  if (!isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("companies")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });
    return ((data ?? []) as Row[]).map((c) => ({
      id: String(c.id),
      orgId: String(c.org_id),
      name: String(c.name ?? ""),
      createdAt: String(c.created_at ?? ""),
    }));
  } catch {
    return [];
  }
}

/** Every company across all orgs (powers the account-assignment dropdowns). */
export async function listAllCompanies(): Promise<CompanyRow[]> {
  if (!isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("companies")
      .select("*")
      .order("name", { ascending: true });
    return ((data ?? []) as Row[]).map((c) => ({
      id: String(c.id),
      orgId: String(c.org_id),
      name: String(c.name ?? ""),
      createdAt: String(c.created_at ?? ""),
    }));
  } catch {
    return [];
  }
}

export async function createCompany(
  orgId: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("companies")
      .insert({ org_id: orgId, name: name.trim() });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function deleteCompany(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("companies").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Assign an account to an organization (and optionally a company within it). */
export async function assignAccount(
  profileId: string,
  input: { orgId: string | null; companyId?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({ org_id: input.orgId, company_id: input.companyId ?? null })
      .eq("id", profileId);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}
