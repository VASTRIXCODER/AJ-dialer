import { NextResponse } from "next/server";
import { createOrganization } from "@/lib/org/membership";
import type { OrgBlueprint } from "@/lib/org/settings";
import { isSuperadmin } from "@/lib/superadmin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Creating organizations is reserved for the platform superadmin.
  if (isSupabaseConfigured() && !(await isSuperadmin()))
    return NextResponse.json(
      { ok: false, error: "Only the platform owner can create organizations." },
      { status: 403 },
    );

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    industry?: string;
    template?: string;
    blueprint?: OrgBlueprint;
  };
  const name = body.blueprint?.name || body.name;
  if (!name?.trim())
    return NextResponse.json(
      { ok: false, error: "Organization name is required." },
      { status: 400 },
    );
  const r = await createOrganization({
    name: name,
    industry: body.industry,
    template: body.template,
    blueprint: body.blueprint,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
