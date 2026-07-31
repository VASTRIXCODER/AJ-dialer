import { NextResponse } from "next/server";
import { getCallCopilot } from "@/lib/ai/services";
import { getLeadById } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";

export async function POST(req: Request) {
  const { leadId } = (await req.json().catch(() => ({}))) as { leadId?: string };
  const [lead, viewer] = await Promise.all([
    leadId ? getLeadById(leadId) : Promise.resolve(null),
    getViewer(),
  ]);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const isSolar = viewer.org ? viewer.org.dialerTemplate === "solar" : true;
  return NextResponse.json(await getCallCopilot(lead, isSolar));
}
