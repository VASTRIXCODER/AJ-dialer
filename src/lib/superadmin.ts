import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";

// ─────────────────────────────────────────────────────────────────────────────
// Secret superadmin ("app management") access — a tamper-proof, HMAC-signed
// httpOnly cookie, entirely separate from Supabase accounts. The credentials
// default to the agreed passphrase but are env-overridable for real security.
// The password lives only in this server-only module (never the client bundle).
// ─────────────────────────────────────────────────────────────────────────────

const USER = (process.env.SUPERADMIN_USER || "superadmin").toLowerCase();
const PASSWORD = process.env.SUPERADMIN_PASSWORD || "keystoeverything";
const SECRET = process.env.SUPERADMIN_SECRET || `${PASSWORD}::aiatwork-superadmin`;

export const SA_COOKIE = "sa_session";
const MAX_AGE_SEC = 60 * 60 * 12; // 12h

export function validateSuperadmin(username: string, password: string): boolean {
  return (username ?? "").trim().toLowerCase() === USER && password === PASSWORD;
}

export function signSuperadminToken(): string {
  const ts = Date.now().toString(36);
  const sig = crypto.createHmac("sha256", SECRET).update(ts).digest("hex");
  return `${ts}.${sig}`;
}

function verify(value?: string | null): boolean {
  if (!value) return false;
  const [ts, sig] = value.split(".");
  if (!ts || !sig) return false;
  const ageMs = Date.now() - parseInt(ts, 36);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_AGE_SEC * 1000) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(ts).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** True when the current request carries a valid superadmin session cookie. */
export async function isSuperadmin(): Promise<boolean> {
  try {
    const store = await cookies();
    return verify(store.get(SA_COOKIE)?.value);
  } catch {
    return false;
  }
}

export const SA_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SEC,
};
