import { NextResponse } from "next/server";
import { createCampaign, setCampaignStatus } from "@/lib/db/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { name, utilityProvider, color } = (await req
    .json()
    .catch(() => ({}))) as { name?: string; utilityProvider?: string; color?: string };
  if (!name || !name.trim()) {
    return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
  }
  const r = await createCampaign({ name: name.trim(), utilityProvider, color });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function PATCH(req: Request) {
  const { id, status } = (await req.json().catch(() => ({}))) as {
    id?: string;
    status?: "active" | "paused" | "completed";
  };
  if (!id || !status) {
    return NextResponse.json(
      { ok: false, error: "id and status are required." },
      { status: 400 },
    );
  }
  const r = await setCampaignStatus(id, status);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
