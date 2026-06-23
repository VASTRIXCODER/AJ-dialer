import { NextResponse } from "next/server";
import { generateOrgBlueprint } from "@/lib/org/org-builder";
import { isSuperadmin } from "@/lib/superadmin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/** Generate a white-label org blueprint from a business description (preview). */
export async function POST(req: Request) {
  // Creating organizations is reserved for the platform superadmin.
  if (isSupabaseConfigured() && !(await isSuperadmin()))
    return NextResponse.json(
      { ok: false, error: "Only the platform owner can create organizations." },
      { status: 403 },
    );

  const { description, name, industry } = (await req.json().catch(() => ({}))) as {
    description?: string;
    name?: string;
    industry?: string;
  };
  if (!description?.trim() && !name?.trim())
    return NextResponse.json(
      { ok: false, error: "Describe your business so the AI can design it." },
      { status: 400 },
    );

  const { blueprint, source } = await generateOrgBlueprint(description ?? "", {
    name,
    industry,
  });
  return NextResponse.json({ ok: true, blueprint, source });
}
