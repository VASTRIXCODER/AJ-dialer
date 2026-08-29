import { NextResponse } from "next/server";
import { cloneCampaign } from "@/lib/db/pipeline";

export const dynamic = "force-dynamic";

/**
 * POST { id } → duplicate a campaign's full setup (identity, scripts, policy
 * columns) as a PAUSED "<name> (copy)". Authorization + the audit row (an
 * assignment_events 'campaign_cloned' entry) live in cloneCampaign.
 */
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  const r = await cloneCampaign(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
