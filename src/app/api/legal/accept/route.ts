import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { clientIpFrom, recordLegalAcceptance } from "@/lib/legal/record-acceptance";
import { isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records the signup clickwrap acceptance (Terms / Privacy / Acceptable Use) —
 * the audit trail a real dispute would need: who, what exact text, what
 * version, from where, when. Called right after supabase.auth.signUp()
 * resolves, whether or not that call already produced a session.
 *
 * Immediately after a real signUp() call, Supabase has just minted `data.user`
 * regardless of whether email confirmation is pending (no session yet in that
 * case) — so a session is preferred (authoritative), but the client-supplied
 * id is trusted as a fallback for that pending-confirmation window. Forging an
 * id here only produces a spurious AUDIT row; it grants no access, since this
 * table backs no permission check.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    email?: string;
  };

  const user = await getUser();
  const userId = user?.id ?? (body.userId && UUID.test(body.userId) ? body.userId : null);
  const email = user?.email ?? (typeof body.email === "string" ? body.email.trim() : "");

  if (!userId) {
    return NextResponse.json({ ok: false, error: "No account to record acceptance for." }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    // Demo mode / no service role — nothing to persist, but never block signup over it.
    return NextResponse.json({ ok: true, recorded: false });
  }

  await recordLegalAcceptance({
    userId,
    email,
    ip: clientIpFrom(req),
    userAgent: req.headers.get("user-agent") ?? "",
  });
  return NextResponse.json({ ok: true, recorded: true });
}
