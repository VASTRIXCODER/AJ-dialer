import { NextResponse } from "next/server";
import { getCallSummary } from "@/lib/ai/services";
import { getLeadById } from "@/lib/data";
import type { CallOutcome } from "@/lib/types";

export async function POST(req: Request) {
  const { leadId, outcome } = await req
    .json()
    .catch(() => ({}) as { leadId?: string; outcome?: CallOutcome });
  const lead = leadId ? getLeadById(leadId) : null;
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  return NextResponse.json(await getCallSummary(lead, outcome));
}
