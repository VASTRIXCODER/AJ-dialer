import { NextResponse } from "next/server";
import { createOrgCompany, deleteOrgCompany } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  const r = await createOrgCompany(name ?? "");
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required." }, { status: 400 });
  const r = await deleteOrgCompany(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
