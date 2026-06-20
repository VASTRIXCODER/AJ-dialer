import { NextResponse } from "next/server";
import { getLeadBriefing } from "@/lib/ai/services";
import { getLeadById } from "@/lib/db/leads";

export async function POST(req: Request) {
  const { leadId } = await req.json().catch(() => ({}) as { leadId?: string });
  const lead = leadId ? await getLeadById(leadId) : null;
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  return NextResponse.json(await getLeadBriefing(lead));
}
