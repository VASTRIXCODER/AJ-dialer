import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import {
  addTeamMember,
  listTeamMembers,
  removeTeamMember,
  updateTeamMember,
} from "@/lib/db/team";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getUser();
  if (!me) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return NextResponse.json({ members: await listTeamMembers() });
}

export async function POST(req: Request) {
  const me = await getUser();
  if (!me)
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    role?: string;
    accessLevel?: string;
    permissions?: Record<string, boolean>;
    sendInvite?: boolean;
  };

  if (!body.email || !body.email.includes("@")) {
    return NextResponse.json(
      { ok: false, error: "A valid email is required." },
      { status: 400 },
    );
  }

  const result = await addTeamMember({
    email: body.email,
    name: body.name,
    role: body.role,
    accessLevel: body.accessLevel,
    permissions: body.permissions,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  // Optionally send a real Supabase invite email (requires service role).
  let invited = false;
  let note: string | undefined;
  if (body.sendInvite) {
    if (!isAdminConfigured()) {
      note = "Member saved. Add SUPABASE_SERVICE_ROLE_KEY to send invite emails.";
    } else {
      try {
        const admin = createAdminClient();
        const { error } = await admin.auth.admin.inviteUserByEmail(body.email);
        invited = !error;
        if (error) note = `Member saved, but invite email failed: ${error.message}`;
      } catch (e) {
        note = `Member saved, but invite email failed: ${e instanceof Error ? e.message : "error"}`;
      }
    }
  }

  return NextResponse.json({ ok: true, id: result.id, invited, note });
}

export async function PATCH(req: Request) {
  const me = await getUser();
  if (!me)
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const { id, ...patch } = (await req.json().catch(() => ({}))) as {
    id?: string;
    role?: string;
    accessLevel?: string;
    status?: string;
    permissions?: Record<string, boolean>;
  };
  if (!id)
    return NextResponse.json({ ok: false, error: "id required." }, { status: 400 });
  const r = await updateTeamMember(id, patch);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function DELETE(req: Request) {
  const me = await getUser();
  if (!me)
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id)
    return NextResponse.json({ ok: false, error: "id required." }, { status: 400 });
  const r = await removeTeamMember(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
