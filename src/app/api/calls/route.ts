import { NextResponse } from "next/server";
import { insertCallRecord } from "@/lib/db/records";
import type { CallOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Persist a human-dialed call disposition to the signed-in account. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    leadId?: string;
    leadName?: string;
    phone?: string;
    durationSec?: number;
    outcome?: CallOutcome;
  };

  await insertCallRecord({
    leadId: body.leadId ?? null,
    leadName: body.leadName,
    phone: body.phone,
    durationSec: body.durationSec,
    outcome: body.outcome,
    channel: "human",
  });

  return NextResponse.json({ ok: true });
}
