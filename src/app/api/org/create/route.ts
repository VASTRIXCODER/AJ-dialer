import { NextResponse } from "next/server";
import { createOrganization } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    industry?: string;
    template?: string;
  };
  if (!body.name?.trim())
    return NextResponse.json(
      { ok: false, error: "Organization name is required." },
      { status: 400 },
    );
  const r = await createOrganization({
    name: body.name,
    industry: body.industry,
    template: body.template,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
