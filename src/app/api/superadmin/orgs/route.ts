import { NextResponse } from "next/server";
import {
  createCompany,
  createOrganization,
  createOrganizationFromBlueprint,
  decideOrgMember,
  deleteCompany,
  deleteOrganization,
  getOrganizationDetail,
  listCompanies,
  listMembersForOrg,
  removeOrgMember,
  setOrgMemberRole,
  updateOrganization,
} from "@/lib/db/org-control";
import { generateOrgBlueprint } from "@/lib/org/org-builder";
import type { OrgBlueprint } from "@/lib/org/settings";
import { isSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";

/** Drill into one org: detail + members + companies. */
export async function GET(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orgId = new URL(req.url).searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ companies: [] });
  const [org, members, companies] = await Promise.all([
    getOrganizationDetail(orgId),
    listMembersForOrg(orgId),
    listCompanies(orgId),
  ]);
  return NextResponse.json({ org, members, companies });
}

export async function POST(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    name?: string;
    industry?: string;
    description?: string;
    orgId?: string;
    id?: string;
    role?: string;
    blueprint?: OrgBlueprint;
  };

  switch (body.action) {
    case "createOrg": {
      if (!body.name?.trim())
        return NextResponse.json({ ok: false, error: "Name required" }, { status: 400 });
      const r = await createOrganization({ name: body.name, industry: body.industry });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "aiBuild": {
      const { blueprint, source } = await generateOrgBlueprint(body.description ?? "", {
        name: body.name,
        industry: body.industry,
      });
      return NextResponse.json({ ok: true, blueprint, source });
    }
    case "createFromBlueprint": {
      if (!body.blueprint)
        return NextResponse.json({ ok: false, error: "Blueprint required" }, { status: 400 });
      const r = await createOrganizationFromBlueprint(body.blueprint);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "createCompany": {
      if (!body.orgId || !body.name?.trim())
        return NextResponse.json({ ok: false, error: "orgId and name required" }, { status: 400 });
      const r = await createCompany(body.orgId, body.name);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "deleteCompany": {
      if (!body.id)
        return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const r = await deleteCompany(body.id);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "memberApprove":
    case "memberReject": {
      if (!body.id)
        return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const r = await decideOrgMember(
        body.id,
        body.action === "memberApprove" ? "approve" : "reject",
      );
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "memberRole": {
      if (!body.id || !body.role)
        return NextResponse.json({ ok: false, error: "id and role required" }, { status: 400 });
      const r = await setOrgMemberRole(body.id, body.role);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "memberRemove": {
      if (!body.id)
        return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const r = await removeOrgMember(body.id);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    default:
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, ...patch } = (await req.json().catch(() => ({}))) as Record<
    string,
    unknown
  > & { id?: string };
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
