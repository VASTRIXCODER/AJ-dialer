import { NextResponse } from "next/server";
import {
  createCompany,
  createOrganization,
  deleteCompany,
  deleteOrganization,
  listCompanies,
  updateOrganization,
} from "@/lib/db/org-control";
import { isSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";

/** Companies for one organization (for expand / assignment dropdowns). */
export async function GET(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orgId = new URL(req.url).searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ companies: [] });
  return NextResponse.json({ companies: await listCompanies(orgId) });
}

export async function POST(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: "createOrg" | "createCompany" | "deleteCompany";
    name?: string;
    industry?: string;
    orgId?: string;
    id?: string;
  };

  if (body.action === "createOrg") {
    if (!body.name?.trim())
      return NextResponse.json({ ok: false, error: "Name required" }, { status: 400 });
    const r = await createOrganization({ name: body.name, industry: body.industry });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.action === "createCompany") {
    if (!body.orgId || !body.name?.trim())
      return NextResponse.json({ ok: false, error: "orgId and name required" }, { status: 400 });
    const r = await createCompany(body.orgId, body.name);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.action === "deleteCompany") {
    if (!body.id)
      return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    const r = await deleteCompany(body.id);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export async function PATCH(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, ...patch } = (await req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    industry?: string;
    status?: string;
  };
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const r = await updateOrganization(id, patch);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function DELETE(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const r = await deleteOrganization(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
