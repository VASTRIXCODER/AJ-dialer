import { NextResponse } from "next/server";
import { reclaimLeadPack } from "@/lib/db/lead-packs";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/** Take a pack back: its leads return to the unassigned pool. */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { ok: false, error: "Only admins and managers can reclaim lead packs." },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { packId?: string };
  const result = await reclaimLeadPack(String(body.packId ?? ""));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
