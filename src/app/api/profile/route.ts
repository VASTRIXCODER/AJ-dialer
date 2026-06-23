import { NextResponse } from "next/server";
import { updateProfile } from "@/lib/db/team";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { fullName, team, preferences } = (await req.json().catch(() => ({}))) as {
    fullName?: string;
    team?: string;
    preferences?: Record<string, unknown>;
  };
  const r = await updateProfile({ fullName, team, preferences });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
