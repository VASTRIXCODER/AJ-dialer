import "server-only";

import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  avatarColor: string;
}

/** Team members visible to the account (RLS-scoped; just you on the per-account model). */
export async function getTeam(): Promise<TeamMember[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase.from("profiles").select("*");
    return (data ?? []).map((p: Record<string, unknown>) => ({
      id: String(p.id),
      name: (p.full_name as string) || "Teammate",
      email: p.id === user.id ? (user.email ?? "") : "",
      role: (p.role as string) || "manager",
      team: (p.team as string) || "AIATWORK",
      // Empty when unset — Avatar's seed prop then hash-picks a chart tone,
      // which tracks light/dark instead of a flat hardcoded blue.
      avatarColor: (p.avatar_color as string) || "",
    }));
  } catch {
    return [];
  }
}

// ── User management (team roster, roles, access & permissions) ───────────────
export const PERMISSION_KEYS = [
  "dial",
  "leads",
  "reports",
  "appointments",
  "team",
  "settings",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "manager" | "rep";
  accessLevel: "full" | "standard" | "limited";
  permissions: Record<string, boolean>;
  status: "invited" | "active" | "disabled";
  createdAt: string;
}

function rowToUser(r: Record<string, unknown>): ManagedUser {
  return {
    id: String(r.id),
    email: (r.email as string) ?? "",
    name: (r.name as string) ?? "",
    role: ((r.role as ManagedUser["role"]) ?? "rep"),
    accessLevel: ((r.access_level as ManagedUser["accessLevel"]) ?? "standard"),
    permissions: (r.permissions as Record<string, boolean>) ?? {},
    status: ((r.status as ManagedUser["status"]) ?? "invited"),
    createdAt: (r.created_at as string) ?? new Date().toISOString(),
  };
}

export async function listTeamMembers(): Promise<ManagedUser[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from("team_members")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    return (data ?? []).map(rowToUser);
  } catch {
    return [];
  }
}

export async function addTeamMember(input: {
  email: string;
  name?: string;
  role?: string;
  accessLevel?: string;
  permissions?: Record<string, boolean>;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!isSupabaseConfigured())
    return { ok: false, error: "Connect Supabase to manage users." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "You must be signed in." };

    const { data, error } = await supabase
      .from("team_members")
      .insert({
        owner_id: user.id,
        email: input.email.trim().toLowerCase(),
        name: input.name?.trim() ?? "",
        role: input.role ?? "rep",
        access_level: input.accessLevel ?? "standard",
        permissions: input.permissions ?? {},
        status: "invited",
      })
      .select("id")
      .single();
    if (error) {
      const missing = /relation .*team_members.* does not exist/i.test(error.message);
      return {
        ok: false,
        error: missing
          ? "Run the latest supabase/schema.sql to create the team_members table."
          : error.message,
      };
    }
    return { ok: true, id: String(data?.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function updateTeamMember(
  id: string,
  patch: { role?: string; accessLevel?: string; status?: string; permissions?: Record<string, boolean> },
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Not configured." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "You must be signed in." };
    const fields: Record<string, unknown> = {};
    if (patch.role != null) fields.role = patch.role;
    if (patch.accessLevel != null) fields.access_level = patch.accessLevel;
    if (patch.status != null) fields.status = patch.status;
    if (patch.permissions != null) fields.permissions = patch.permissions;
    const { error } = await supabase
      .from("team_members")
      .update(fields)
      .eq("id", id)
      .eq("owner_id", user.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function removeTeamMember(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Not configured." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "You must be signed in." };
    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function updateProfile(input: {
  fullName?: string;
  team?: string;
  /** Merged into the profile's preferences JSONB (UI prefs like saved views). */
  preferences?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured())
    return { ok: false, error: "Connect Supabase to save your profile." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "You must be signed in." };
    const patch: Record<string, unknown> = {};
    if (input.fullName != null) patch.full_name = input.fullName;
    if (input.team != null) patch.team = input.team;
    if (input.preferences) {
      const { data: cur } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", user.id)
        .maybeSingle();
      patch.preferences = {
        ...((cur?.preferences as Record<string, unknown>) ?? {}),
        ...input.preferences,
      };
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", user.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Read the signed-in user's UI preferences (saved views, density, …). */
export async function getUiPreferences(): Promise<Record<string, unknown>> {
  if (!isSupabaseConfigured()) return {};
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return {};
    const { data } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", user.id)
      .maybeSingle();
    return (data?.preferences as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}
