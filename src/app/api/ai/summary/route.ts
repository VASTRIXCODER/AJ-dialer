import { NextResponse } from "next/server";
import { getCallSummary } from "@/lib/ai/services";
import { getLeadById } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import type { CallOutcome } from "@/lib/types";

export async function POST(req: Request) {
  const { leadId, outcome } = (await req.json().catch(() => ({}))) as {
    leadId?: string;
    outcome?: CallOutcome;
  };
  const [lead, viewer] = await Promise.all([
    leadId ? getLeadById(leadId) : Promise.resolve(null),
    getViewer(),
  ]);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const isSolar = viewer.org ? viewer.org.dialerTemplate === "solar" : true;
  return NextResponse.json(await getCallSummary(lead, outcome, isSolar));
}
