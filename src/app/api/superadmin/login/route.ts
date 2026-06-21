import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SA_COOKIE,
  SA_COOKIE_OPTIONS,
  signSuperadminToken,
  validateSuperadmin,
} from "@/lib/superadmin";

export const dynamic = "force-dynamic";

/**
 * Secret superadmin sign-in. The login form posts here first; a 401 simply means
 * "not the superadmin" and the form falls through to normal Supabase auth.
 */
export async function POST(req: Request) {
  const { username, password } = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  if (!validateSuperadmin(username ?? "", password ?? "")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const store = await cookies();
  store.set(SA_COOKIE, signSuperadminToken(), SA_COOKIE_OPTIONS);
  return NextResponse.json({ ok: true });
}
