import "server-only";

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
}

export interface CompanyRow {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
}

type Row = Record<string, unknown>;
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) ||
  `org-${Date.now().toString(36)}`;

export async function listOrganizations(): Promise<OrganizationRow[]> {
  if (!isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const [orgsRes, companiesRes, profilesRes] = await Promise.all([
      admin.from("organizations").select("*").order("created_at", { ascending: true }),
      admin.from("companies").select("id,org_id"),
      admin.from("profiles").select("id,org_id"),
    ]);
    const companyCount = new Map<string, number>();
    for (const c of (companiesRes.data ?? []) as Row[]) {
      const k = String(c.org_id);
      companyCount.set(k, (companyCount.get(k) ?? 0) + 1);
    }
    const memberCount = new Map<string, number>();
    for (const p of (profilesRes.data ?? []) as Row[]) {
      if (p.org_id) {
        const k = String(p.org_id);
        memberCount.set(k, (memberCount.get(k) ?? 0) + 1);
      }
    }
    return ((orgsRes.data ?? []) as Row[]).map((o) => ({
      id: String(o.id),
      name: String(o.name ?? "Organization"),
      slug: String(o.slug ?? ""),
      industry: String(o.industry ?? ""),
      status: (String(o.status ?? "active") as OrganizationRow["status"]),
      createdAt: String(o.created_at ?? ""),
      companyCount: companyCount.get(String(o.id)) ?? 0,
      memberCount: memberCount.get(String(o.id)) ?? 0,
    }));
  } catch {
    return [];
  }
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

export async function updateOrganization(
  id: string,
  patch: { name?: string; industry?: string; status?: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const fields: Record<string, unknown> = {};
    if (patch.name != null) fields.name = patch.name;
    if (patch.industry != null) fields.industry = patch.industry;
    if (patch.status != null) fields.status = patch.status;
    const { error } = await admin.from("organizations").update(fields).eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
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
