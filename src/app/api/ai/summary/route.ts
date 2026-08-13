import { NextResponse } from "next/server";
import { orgAIContext } from "@/lib/ai/org-context";
import { getCallSummary } from "@/lib/ai/services";
import { getLeadById } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import type { CallOutcome } from "@/lib/types";

export async function POST(req: Request) {
  const { leadId, outcome, notes, durationSec } = (await req
    .json()
    .catch(() => ({}))) as {
    leadId?: string;
    outcome?: CallOutcome;
    /** The rep's in-call notes — the evidence a manual call leaves behind. */
    notes?: string;
    durationSec?: number;
  };
  const [lead, viewer] = await Promise.all([
    leadId ? getLeadById(leadId) : Promise.resolve(null),
    getViewer(),
  ]);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const ctx = orgAIContext(viewer.org);
  return NextResponse.json(
    await getCallSummary(
      lead,
      outcome,
      ctx.isSolar,
      {
        notes: typeof notes === "string" ? notes.slice(0, 4000) : undefined,
        durationSec:
          typeof durationSec === "number" && Number.isFinite(durationSec)
            ? Math.max(0, Math.round(durationSec))
            : undefined,
      },
      ctx,
    ),
  );
}
