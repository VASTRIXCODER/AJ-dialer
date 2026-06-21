import { NextResponse } from "next/server";
import { joinByCode } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code?.trim())
    return NextResponse.json({ ok: false, error: "Enter a join code." }, { status: 400 });
  const r = await joinByCode(code);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
