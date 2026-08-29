import { NextResponse } from "next/server";
import {
  createCampaign,
  deleteCampaign,
  setCampaignStatus,
  updateCampaign,
  type CampaignPatch,
} from "@/lib/db/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { name, utilityProvider, color, scriptA, scriptB } = (await req
    .json()
    .catch(() => ({}))) as {
    name?: string;
    utilityProvider?: string;
    color?: string;
    scriptA?: string;
    scriptB?: string;
  };
  if (!name || !name.trim()) {
    return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
  }
  const r = await createCampaign({ name: name.trim(), utilityProvider, color, scriptA, scriptB });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

/** The PATCH body: id + any subset of the editable fields (see CampaignPatch). */
type PatchBody = CampaignPatch & { id?: string; status?: "active" | "paused" | "completed" };

/** Body keys (beyond id/status) that make this an EDIT rather than a toggle. */
const EDIT_KEYS = [
  "name",
  "utilityProvider",
  "color",
  "scriptA",
  "scriptB",
  "description",
  "objective",
  "archived",
  "audience",
  "dialingPolicy",
  "callerIds",
  "retryPolicy",
  "dispositionKeys",
  "goals",
] as const satisfies readonly (keyof CampaignPatch)[];

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const { id, status } = body;
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  }
  // A status-only PATCH stays the lightweight pause/resume toggle; anything
  // more becomes a sparse edit of the campaign's own fields. Every editable
  // key must count as editing, or a single-section save (e.g. the builder's
  // Dispositions card) falls into the toggle branch and 400s.
  //
  // The jsonb payloads (audience / dialingPolicy / retryPolicy / goals) and
  // the two org-checked lists (callerIds ⊆ the org pool, dispositionKeys ⊆
  // the resolved disposition set) are validated inside updateCampaign — the
  // route only decides WHICH keys travel, never trusts their shape.
  const editing = EDIT_KEYS.some((k) => body[k] !== undefined);
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
  const patch: CampaignPatch = { status };
  for (const k of EDIT_KEYS) {
    if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
  }
  const r = await updateCampaign(id, patch);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function DELETE(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  const r = await deleteCampaign(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
