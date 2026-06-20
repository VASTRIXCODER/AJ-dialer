import { NextResponse } from "next/server";
import { getAICall, updateAICall } from "@/lib/ai-call-store";
import { analyzeConversation } from "@/lib/ai/services";
import { dispositionBlurb, unconnectedOutcome } from "@/lib/call-disposition";
import { completeAIConversation } from "@/lib/db/records";
import { getLeadById } from "@/lib/db/leads";
import { verifyWebhookSignature } from "@/lib/elevenlabs";
import type { CallOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

type Turn = { role?: string; speaker?: string; message?: string; text?: string };

/**
 * Post-call webhook — the "data back" leg of the chain. ElevenLabs posts the
 * full transcript + metadata when a call ends; we verify the HMAC signature and
 * then either:
 *   • run Claude to extract a summary / disposition / appointment (real talk), or
 *   • auto-categorize deterministically when the call never connected (no answer,
 *     voicemail, dead number) — no transcript to reason over, so no Claude spend.
 * Either way the live monitor + Supabase are updated and attributed to the owner.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("elevenlabs-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const data = (payload.data ?? payload) as Record<string, unknown>;
  const conversationId = String(
    data.conversation_id ?? data.conversationId ?? "",
  );
  if (!conversationId) return NextResponse.json({ received: true });

  const turns: Turn[] = Array.isArray(data.transcript)
    ? (data.transcript as Turn[])
    : [];
  const transcript = turns
    .map((t) => `${t.role ?? t.speaker ?? "agent"}: ${t.message ?? t.text ?? ""}`)
    .filter((line) => line.trim().length > 3)
    .join("\n");

  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const durationSec =
    Number(metadata.call_duration_secs ?? metadata.call_duration ?? 0) ||
    undefined;
  const terminationReason = String(
    metadata.termination_reason ??
      metadata.call_termination_reason ??
      data.status ??
      "",
  );

  // Did a real two-way conversation happen? We need the homeowner (not just the
  // agent) to have said something. If not, the call "didn't go through".
  const humanSaidSomething = turns.some(
    (t) =>
      (t.role ?? t.speaker) !== "agent" &&
      (t.message ?? t.text ?? "").trim().length > 1,
  );
  const status = String(data.status ?? "").toLowerCase();
  const connected =
    humanSaidSomething && status !== "failed" && status !== "error";

  const tracked = getAICall(conversationId);
  const lead = tracked?.leadId ? await getLeadById(tracked.leadId) : null;

  let summary: string;
  let outcome: CallOutcome;
  let sentiment: "positive" | "neutral" | "negative";
  let appointment: { when: string; notes: string } | null = null;

  if (connected) {
    const { data: analysis } = await analyzeConversation({ transcript, lead });
    summary = analysis.summary;
    outcome = analysis.outcome;
    sentiment = analysis.sentiment;
    appointment = analysis.appointment.requested
      ? { when: analysis.appointment.when, notes: analysis.appointment.notes }
      : null;
  } else {
    // Auto-end + auto-categorize a call that never connected.
    outcome = unconnectedOutcome(terminationReason, durationSec ?? 0);
    sentiment = "neutral";
    summary = dispositionBlurb(outcome);
  }

  // Live monitor (in-memory)
  updateAICall(conversationId, {
    state: connected ? "completed" : "failed",
    endedAt: Date.now(),
    durationSec,
    summary,
    outcome,
    sentiment,
    recordingAvailable: connected,
    appointment,
  });

  // Durable persistence (Supabase) — completes the conversation row and creates
  // the call record + appointment, attributed to the lead's owner account.
  await completeAIConversation({
    conversationId,
    summary,
    outcome,
    sentiment,
    durationSec,
    appointment,
    state: connected ? "completed" : "failed",
  });

  return NextResponse.json({ received: true });
}
