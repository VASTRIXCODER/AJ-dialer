import { NextResponse } from "next/server";
import {
  type OrgUpdate,
  deleteOrganization,
  rotateJoinCode,
  updateOrganizationSettings,
} from "@/lib/org/membership";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as OrgUpdate;
  const r = await updateOrganizationSettings(body);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function POST(req: Request) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action === "rotateCode") {
    const r = await rotateJoinCode();
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}

export async function DELETE() {
  const r = await deleteOrganization();
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
