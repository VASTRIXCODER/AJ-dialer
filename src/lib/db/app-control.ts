import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Superadmin app controls — global maintenance/kill switch + account management.
// All via the service-role client (bypasses RLS); only reached from superadmin-
// gated routes. Every function degrades gracefully if the service role or the
// new schema isn't present.
// ─────────────────────────────────────────────────────────────────────────────

export interface AppSettings {
  maintenance: boolean;
  message: string;
}

export async function getAppSettings(): Promise<AppSettings> {
  if (!isAdminConfigured()) return { maintenance: false, message: "" };
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("app_settings")
      .select("maintenance,message")
      .eq("id", "global")
      .maybeSingle();
    return {
      maintenance: Boolean(data?.maintenance),
      message: (data?.message as string) ?? "",
    };
  } catch {
    return { maintenance: false, message: "" };
  }
}

export async function setAppSettings(input: {
  maintenance?: boolean;
  message?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured())
    return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const patch: Record<string, unknown> = {
      id: "global",
      updated_at: new Date().toISOString(),
    };
    if (input.maintenance != null) patch.maintenance = input.maintenance;
    if (input.message != null) patch.message = input.message;
    const { error } = await admin.from("app_settings").upsert(patch);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export interface AccountRow {
  id: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  orgId: string | null;
  companyId: string | null;
}

export async function listAccounts(): Promise<AccountRow[]> {
  if (!isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 200 });
    const users = usersData?.users ?? [];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, role, disabled, org_id, company_id");
    const pmap = new Map(
      (profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), p]),
    );
    return users.map((u) => {
      const p = (pmap.get(u.id) ?? {}) as Record<string, unknown>;
      return {
        id: u.id,
        email: u.email ?? "",
        name: (p.full_name as string) || (u.email?.split("@")[0] ?? "Account"),
        role: (p.role as string) || "manager",
        disabled: Boolean(p.disabled),
        createdAt: u.created_at ?? "",
        lastSignInAt: u.last_sign_in_at ?? null,
        orgId: (p.org_id as string) ?? null,
        companyId: (p.company_id as string) ?? null,
      };
    });
  } catch {
    return [];
  }
}

export async function setAccountDisabled(
  id: string,
  disabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured())
    return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({ disabled })
      .eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function deleteAccount(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured())
    return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Whether a given account is suspended (used to block them from the app). */
export async function isAccountDisabled(id: string): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("disabled")
      .eq("id", id)
      .maybeSingle();
    return Boolean(data?.disabled);
  } catch {
    return false;
  }
}
