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
      avatarColor: (p.avatar_color as string) || "#3B82F6",
    }));
  } catch {
    return [];
  }
}

export async function updateProfile(input: {
  fullName?: string;
  team?: string;
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
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", user.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}
