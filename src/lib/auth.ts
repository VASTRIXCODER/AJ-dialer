import "server-only";

import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";

/** The signed-in user, or null in demo mode / when signed out. */
export async function getUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

/** A short display name + initials derived from the user. */
export function userDisplay(user: User | null) {
  const name =
    (user?.user_metadata?.full_name as string) ||
    user?.email?.split("@")[0] ||
    "Your Account";
  const initials = name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return { name, email: user?.email ?? "", initials: initials || "·" };
}
