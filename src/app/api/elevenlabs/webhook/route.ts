import { NextResponse } from "next/server";
import { finalizeAIConversation, type Turn } from "@/lib/ai-call-finalize";
import { verifyWebhookSignature } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

/**
 * Post-call webhook — the "data back" leg of the chain. ElevenLabs posts the
 * full transcript + metadata when a call ends; we verify the HMAC signature and
 * hand it to finalizeAIConversation, which either runs Claude (real talk) or
 * deterministically categorizes a call that never connected (no answer /
 * voicemail / dead number) — then updates the live monitor and Supabase.
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

  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const durationSec =
    Number(metadata.call_duration_secs ?? metadata.call_duration ?? 0) ||
    undefined;
  const terminationReason = String(
    metadata.termination_reason ?? metadata.call_termination_reason ?? "",
  );

  await finalizeAIConversation({
    conversationId,
    turns,
    status: String(data.status ?? ""),
    durationSec,
    terminationReason,
  });

  return NextResponse.json({ received: true });
}
