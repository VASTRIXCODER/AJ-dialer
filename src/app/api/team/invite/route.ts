import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Invite a teammate by email (Supabase admin invite). Requires service role. */
export async function POST(req: Request) {
  const me = await getUser();
  if (!me) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Set SUPABASE_SERVICE_ROLE_KEY to invite teammates." },
      { status: 400 },
    );
  }
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, error: "Valid email required." }, { status: 400 });
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invite failed." },
      { status: 500 },
    );
  }
}
