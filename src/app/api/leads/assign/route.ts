import { NextResponse } from "next/server";
import { assignLeadsToCampaign } from "@/lib/db/pipeline";

export const dynamic = "force-dynamic";

/** Assign (or clear, with campaignId: null) a set of leads to a campaign. */
export async function POST(req: Request) {
  const { leadIds, campaignId } = (await req.json().catch(() => ({}))) as {
    leadIds?: string[];
    campaignId?: string | null;
  };
  if (!Array.isArray(leadIds) || leadIds.length === 0)
    return NextResponse.json({ ok: false, error: "leadIds are required." }, { status: 400 });
  const r = await assignLeadsToCampaign(leadIds, campaignId ?? null);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
