import { NextResponse } from "next/server";
import {
  deleteAccount,
  getAppSettings,
  listAccounts,
  setAccountDisabled,
  setAppSettings,
} from "@/lib/db/app-control";
import { isSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [settings, accounts] = await Promise.all([getAppSettings(), listAccounts()]);
  return NextResponse.json({ settings, accounts });
}

export async function POST(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: "maintenance" | "disable" | "enable" | "delete";
    id?: string;
    on?: boolean;
    message?: string;
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
    default:
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }
}
