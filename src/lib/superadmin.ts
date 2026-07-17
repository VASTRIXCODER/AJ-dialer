import "server-only";

import { cache } from "react";
import { getUser } from "./auth";
import { isAccountDisabled, isPlatformAdmin } from "./db/app-control";

// ─────────────────────────────────────────────────────────────────────────────
// Hidden platform superadmin — tied to your REAL Supabase identity, not a
// separate password or cookie. This removes the old forgeable `sa_session` token
// and the sticky-cross-user bug (a leftover cookie sending the next person who
// signs in straight into the console).
//
// You are a superadmin if your signed-in email is in SUPERADMIN_EMAILS (the
// un-lock-out-able bootstrap) OR your account is in the service-role-only
// `platform_admins` table. It's never shown on your profile; you appear as a
// normal member of your org and reach the console through a discreet entry.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWLIST = (process.env.SUPERADMIN_EMAILS || "")
  .split(/[,\s]+/)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** The email allowlist (for diagnostics / setup hints). */
export function superadminAllowlist(): string[] {
  return ALLOWLIST;
}

/**
 * True when the CURRENT signed-in user is a platform superadmin. Allowlisted
 * emails are always superadmin (can't be locked out); DB-promoted superadmins
 * additionally lose access if their account is suspended.
 */
export const isSuperadmin = cache(async (): Promise<boolean> => {
  const user = await getUser();
  if (!user) return false;
  const email = (user.email || "").toLowerCase();
  if (email && ALLOWLIST.includes(email)) return true;
  if (await isPlatformAdmin(user.id)) return !(await isAccountDisabled(user.id));
  return false;
});
