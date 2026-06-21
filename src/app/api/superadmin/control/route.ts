import { NextResponse } from "next/server";
import {
  deleteAccount,
  getAppSettings,
  listAccounts,
  setAccountDisabled,
  setAppSettings,
} from "@/lib/db/app-control";
import {
  assignAccount,
  listAllCompanies,
  listOrganizations,
} from "@/lib/db/org-control";
import { isSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [settings, accounts, organizations, companies] = await Promise.all([
    getAppSettings(),
    listAccounts(),
    listOrganizations(),
    listAllCompanies(),
  ]);
  return NextResponse.json({ settings, accounts, organizations, companies });
}

export async function POST(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: "maintenance" | "disable" | "enable" | "delete" | "assign";
    id?: string;
    on?: boolean;
    message?: string;
    orgId?: string | null;
    companyId?: string | null;
  };

  switch (body.action) {
    case "maintenance": {
      const r = await setAppSettings({ maintenance: !!body.on, message: body.message });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "disable":
    case "enable": {
      if (!body.id)
        return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const r = await setAccountDisabled(body.id, body.action === "disable");
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "delete": {
      if (!body.id)
        return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const r = await deleteAccount(body.id);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "assign": {
      if (!body.id)
        return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const r = await assignAccount(body.id, {
        orgId: body.orgId ?? null,
        companyId: body.companyId ?? null,
      });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    default:
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }
}
