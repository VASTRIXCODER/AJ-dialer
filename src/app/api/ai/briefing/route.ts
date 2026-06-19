import { NextResponse } from "next/server";
import { getLeadBriefing } from "@/lib/ai/services";
import { getLeadById } from "@/lib/data";

export async function POST(req: Request) {
  const { leadId } = await req.json().catch(() => ({}) as { leadId?: string });
  const lead = leadId ? getLeadById(leadId) : null;
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  return NextResponse.json(await getLeadBriefing(lead));
}
