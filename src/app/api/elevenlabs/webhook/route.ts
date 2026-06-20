import { NextResponse } from "next/server";
import { getAICall, updateAICall } from "@/lib/ai-call-store";
import { analyzeConversation } from "@/lib/ai/services";
import { getLeadById } from "@/lib/data";
import { verifyWebhookSignature } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

type Turn = { role?: string; speaker?: string; message?: string; text?: string };

/**
 * Post-call webhook — the "data back" leg of the chain. ElevenLabs posts the
 * full transcript + metadata when a call ends; we verify the HMAC signature,
 * run Claude to extract a summary / disposition / qualification / appointment,
 * and update the live store. This is where you'd also persist to your CRM/DB.
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

  const tracked = getAICall(conversationId);
  const lead = tracked?.leadId ? (getLeadById(tracked.leadId) ?? null) : null;

  const { data: analysis } = await analyzeConversation({ transcript, lead });

  updateAICall(conversationId, {
    state: "completed",
    endedAt: Date.now(),
    durationSec,
    summary: analysis.summary,
    outcome: analysis.outcome,
    sentiment: analysis.sentiment,
    recordingAvailable: true,
    appointment: analysis.appointment.requested
      ? { when: analysis.appointment.when, notes: analysis.appointment.notes }
      : null,
  });

  // Production hook: persist analysis.qualification onto the lead, create an
  // Appointment / Callback record, and update CRM. The store update above is the
  // demo-friendly seam — swap for your datastore.

  return NextResponse.json({ received: true });
}
