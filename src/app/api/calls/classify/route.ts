import { NextResponse } from "next/server";
import { orgAIContext } from "@/lib/ai/org-context";
import { getCallSummary } from "@/lib/ai/services";
import { getLeadById } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import type { CallOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Power-mode disposition classifier.
 *
 * A finished call (manual or AI) is handed here so the model can read the
 * outcome from whatever evidence the call left behind — the rep's notes and
 * the duration for a manual call, plus the transcript once one exists (AI
 * calls already carry one; manual calls will when STT lands). The dialer keeps
 * dialing while this runs; the answer lands in the pending-dispositions widget
 * where it either auto-applies (auto-confirm on) or waits for the rep.
 *
 * Returns `{ outcome, summary, confidence, source }`. Never throws for the
 * caller — a failure comes back as `{ ok: false }` so the widget can show the
 * row as "needs review" rather than losing the call.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    leadId?: string;
    durationSec?: number;
    notes?: string;
    transcript?: string;
    /** Whether the call actually connected (had talk time). A call that never
     *  connected is a no-answer and needs no model — we short-circuit it. */
    connected?: boolean;
  };

  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  if (!leadId) {
    return NextResponse.json({ ok: false, error: "leadId is required." }, { status: 400 });
  }

  const durationSec =
    typeof body.durationSec === "number" && Number.isFinite(body.durationSec)
      ? Math.max(0, Math.round(body.durationSec))
      : 0;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : "";
  const transcript = typeof body.transcript === "string" ? body.transcript.slice(0, 12000) : "";
  const connected = body.connected !== false && (durationSec > 0 || transcript.trim().length > 0);

  // A call that never connected is a no-answer. There is nothing for the model
  // to read, so don't spend a request (or latency) guessing — file it directly.
  if (!connected) {
    return NextResponse.json({
      ok: true,
      outcome: "no_answer" as CallOutcome,
      summary: "Call did not connect — no talk time.",
      confidence: 90,
      source: "rule",
    });
  }

  // getLeadById is scope-checked (viewer's active org) and demo-safe, so a
  // caller can only ever classify a call against a lead they can see.
  const lead = await getLeadById(leadId);
  if (!lead) {
    return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });
  }

  try {
    const viewer = await getViewer();
    const ctx = orgAIContext(viewer.org);
    const result = await getCallSummary(
      lead,
      undefined, // no rep-chosen disposition — the model is the one classifying
      ctx.isSolar,
      {
        notes: notes || undefined,
        durationSec: durationSec || undefined,
        transcript: transcript || undefined,
      },
      ctx,
    );

    const outcome = result.data.recommendedOutcome as CallOutcome | undefined;
    const confidence =
      typeof result.data.confidence === "number" && Number.isFinite(result.data.confidence)
        ? Math.max(0, Math.min(100, Math.round(result.data.confidence)))
        : null;

    return NextResponse.json({
      ok: true,
      outcome: outcome ?? null,
      summary: result.data.executiveSummary ?? "",
      confidence,
      source: result.source,
      error: result.error ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Classification failed." },
      { status: 500 },
    );
  }
}
