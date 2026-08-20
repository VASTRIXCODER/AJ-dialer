import { NextResponse } from "next/server";
import {
  decideMember,
  getViewer,
  listMembers,
  removeMember,
  setMemberCallerIds,
  setMemberPermissions,
  setMemberRole,
  transferOwnership,
} from "@/lib/org/membership";
import { type OrgRole, isOrgRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer.org || !viewer.permissions.includes("members.view"))
    return NextResponse.json({ members: [], role: viewer.role, permissions: viewer.permissions });
  const members = await listMembers(viewer.org.id);
  return NextResponse.json({
    members,
    role: viewer.role,
    permissions: viewer.permissions,
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    action?: "approve" | "reject" | "role" | "permissions" | "remove" | "transfer" | "callerIds";
    role?: string;
    permissions?: Record<string, boolean>;
    callerIds?: string[];
  };
  if (!body.id || !body.action)
    return NextResponse.json({ ok: false, error: "id and action required." }, { status: 400 });

  let r: { ok: boolean; error?: string };
  switch (body.action) {
    case "transfer":
      r = await transferOwnership(body.id);
      break;
    case "approve":
      r = await decideMember(
        body.id,
        "approve",
        isOrgRole(body.role) ? (body.role as OrgRole) : undefined,
      );
      break;
    case "reject":
      r = await decideMember(body.id, "reject");
      break;
    case "role":
      if (!isOrgRole(body.role))
        return NextResponse.json({ ok: false, error: "Invalid role." }, { status: 400 });
      r = await setMemberRole(body.id, body.role as OrgRole);
      break;
    case "permissions":
      r = await setMemberPermissions(body.id, body.permissions ?? {});
      break;
    case "callerIds":
      if (!Array.isArray(body.callerIds))
        return NextResponse.json({ ok: false, error: "callerIds must be an array." }, { status: 400 });
      r = await setMemberCallerIds(body.id, body.callerIds);
      break;
    case "remove":
      r = await removeMember(body.id);
      break;
    default:
      return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
