import "server-only";

import { AUP_VERSION, PRIVACY_VERSION, SIGNUP_ACCEPTANCE_TEXT, TERMS_VERSION } from "./versions";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";

/**
 * Persist a signup clickwrap acceptance row. Shared by the email/password path
 * (/api/legal/accept, called right after supabase.auth.signUp()) and the
 * Google OAuth signup path (/auth/callback, which carries the same intent
 * through the redirect as query params since the browser round-trips through
 * Google in between). Best-effort — never throws, and a failure here must
 * never block or unwind an otherwise-successful signup.
 */
export async function recordLegalAcceptance(input: {
  userId: string;
  email: string;
  ip: string;
  userAgent: string;
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    await admin.from("legal_acceptances").insert({
      user_id: input.userId,
      email: input.email,
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
      aup_version: AUP_VERSION,
      acceptance_text: SIGNUP_ACCEPTANCE_TEXT,
      ip_address: input.ip,
      user_agent: input.userAgent,
    });
  } catch {
    /* best-effort — never block signup over an audit-row write */
  }
}

/** Client IP from standard proxy headers (Vercel/most reverse proxies). */
export function clientIpFrom(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    ""
  );
}
