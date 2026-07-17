import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";

/**
 * The signed-in user, or null in demo mode / when signed out.
 *
 * supabase.auth.getUser() is a NETWORK round-trip to the Supabase auth server to
 * validate the JWT, and it was being called 6-7 times per page render (layout,
 * viewer, scope, reporting, monitor, leaderboard, …). Wrapped in React's
 * request-scoped cache() so it resolves ONCE per render and every caller shares
 * the result — collapsing those calls to a single auth round-trip.
 */
export const getUser = cache(async (): Promise<User | null> => {
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
});

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
