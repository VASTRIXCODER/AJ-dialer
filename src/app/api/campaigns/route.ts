import { NextResponse } from "next/server";
import {
  createCampaign,
  deleteCampaign,
  setCampaignStatus,
  updateCampaign,
} from "@/lib/db/pipeline";

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
  const { id, status, name, utilityProvider, color } = (await req
    .json()
    .catch(() => ({}))) as {
    id?: string;
    status?: "active" | "paused" | "completed";
    name?: string;
    utilityProvider?: string;
    color?: string;
  };
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  }
  // A status-only PATCH stays the lightweight pause/resume toggle; anything
  // more becomes a sparse edit of the campaign's own fields.
  const editing = name !== undefined || utilityProvider !== undefined || color !== undefined;
  if (!editing) {
    if (!status) {
      return NextResponse.json(
        { ok: false, error: "id and status are required." },
        { status: 400 },
      );
    }
    const r = await setCampaignStatus(id, status);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  const r = await updateCampaign(id, { name, utilityProvider, color, status });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function DELETE(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  const r = await deleteCampaign(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
