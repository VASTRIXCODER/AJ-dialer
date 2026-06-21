import { NextResponse } from "next/server";
import { switchActiveOrg } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { orgId } = (await req.json().catch(() => ({}))) as { orgId?: string };
  if (!orgId)
    return NextResponse.json({ ok: false, error: "orgId required." }, { status: 400 });
  const r = await switchActiveOrg(orgId);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
