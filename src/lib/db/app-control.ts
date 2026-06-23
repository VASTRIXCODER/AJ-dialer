import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Superadmin app controls — global maintenance/kill switch + account management.
// All via the service-role client (bypasses RLS); only reached from superadmin-
// gated routes. Every function degrades gracefully if the service role or the
// new schema isn't present.
// ─────────────────────────────────────────────────────────────────────────────

type Result = { ok: boolean; error?: string };

/**
 * Append a row to the audit log (best-effort, never throws). Records who did a
 * sensitive thing (suspend, promote, role change, delete) for accountability.
 */
export async function writeAudit(e: {
  action: string;
  actorId?: string | null;
  actorKind?: "user" | "superadmin" | "system";
  targetId?: string | null;
  targetKind?: string | null;
  orgId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    await admin.from("audit_log").insert({
      actor_id: e.actorId ?? null,
      actor_kind: e.actorKind ?? "user",
      action: e.action,
      target_id: e.targetId ?? null,
      target_kind: e.targetKind ?? null,
      org_id: e.orgId ?? null,
      detail: e.detail ?? {},
    });
  } catch {
    /* best-effort */
  }
}

// ── Hidden platform superadmins ──────────────────────────────────────────────
/** Is this account a DB-promoted platform superadmin? (Service-role read.) */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

/** Grant or revoke hidden platform-superadmin status for an account. */
export async function setPlatformAdmin(
  userId: string,
  on: boolean,
): Promise<Result> {
  if (!isAdminConfigured())
    return { ok: false, error: "Service role not configured." };
  try {
    const admin = createAdminClient();
    if (on) await admin.from("platform_admins").upsert({ user_id: userId });
    else await admin.from("platform_admins").delete().eq("user_id", userId);
    await writeAudit({
      action: on ? "platform.grant" : "platform.revoke",
      actorKind: "superadmin",
      targetId: userId,
      targetKind: "account",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

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
  platformAdmin: boolean;
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
    const [{ data: profiles }, { data: platform }] = await Promise.all([
      admin.from("profiles").select("id, full_name, role, disabled, org_id, company_id"),
      admin.from("platform_admins").select("user_id"),
    ]);
    const pmap = new Map(
      (profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), p]),
    );
    const superSet = new Set(
      (platform ?? []).map((r: Record<string, unknown>) => String(r.user_id)),
    );
    return users.map((u) => {
      const p = (pmap.get(u.id) ?? {}) as Record<string, unknown>;
      return {
        id: u.id,
        email: u.email ?? "",
        name: (p.full_name as string) || (u.email?.split("@")[0] ?? "Account"),
        role: (p.role as string) || "manager",
        disabled: Boolean(p.disabled),
        platformAdmin: superSet.has(u.id),
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
    if (error) return { ok: false, error: error.message };
    // Revoke the user's auth sessions so suspension takes effect immediately —
    // a banned user's tokens stop working and they can't sign back in.
    try {
      await admin.auth.admin.updateUserById(id, {
        ban_duration: disabled ? "87600h" : "none",
      });
    } catch {
      /* ban API may be unavailable; app + RLS still block the account */
    }
    await writeAudit({
      action: disabled ? "account.suspend" : "account.restore",
      actorKind: "superadmin",
      targetId: id,
      targetKind: "account",
    });
    return { ok: true };
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
