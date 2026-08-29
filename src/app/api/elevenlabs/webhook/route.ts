import { NextResponse } from "next/server";
import { finalizeAIConversation, type Turn } from "@/lib/ai-call-finalize";
import { applyCallEvent } from "@/lib/calls/apply-event";
import { providerEventFingerprint } from "@/lib/calls/state-machine";
import { elevenLabsConfig, verifyWebhookSignature } from "@/lib/elevenlabs";

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
    // Distinguish "you didn't sign it" from "you never set the secret", because
    // the fix is different and the latter is a deployment misconfiguration that
    // now (correctly) fails closed instead of silently accepting everything.
    if (!elevenLabsConfig.webhookSecret) {
      console.error(
        "[elevenlabs.webhook] Rejected: ELEVENLABS_WEBHOOK_SECRET is not set, so " +
          "webhooks can't be verified. Set it (recommended) or set " +
          "ELEVENLABS_ALLOW_UNSIGNED_WEBHOOK=true to accept unsigned webhooks. " +
          "The reconcile cron still finalizes calls in the meantime.",
      );
    }
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // ── Only the transcript event may finalize a call ───────────────────────────
  // ElevenLabs posts several event types to this one URL. `post_call_audio`
  // carries a conversation_id but NO transcript and NO metadata — so it used to
  // fall straight through to classifyNonConversation as a call with zero turns and
  // zero duration, which files it as `no_answer`. A real, connected, successful
  // call could therefore be overwritten as a miss purely because its audio event
  // landed first. Ignore everything that isn't the transcript.
  const eventType = String(payload.type ?? "");
  if (eventType && eventType !== "post_call_transcription") {
    return NextResponse.json({ received: true, ignored: eventType });
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

  // The provider's own error, which the reconcile path already reads but this one
  // dropped. classifyNonConversation checks the quota message FIRST, ahead of every
  // other rule — and "out of credits" only ever appears in here. Without it, a call
  // the provider killed for an empty wallet came through this webhook looking like
  // an ordinary no-answer: the exact misclassification that hid the outage.
  const error = (metadata.error ?? {}) as Record<string, unknown>;
  const errorCode = error.code == null ? null : String(error.code);
  const errorReason = error.reason == null ? null : String(error.reason);

  // Canonical event log (dual-write): the post-call transcript completes the
  // attempt. Fingerprint on the event id when EL sends one, else the
  // conversation itself — a redelivered webhook is a duplicate, not a re-run.
  await applyCallEvent({
    source: "elevenlabs",
    type: "attempt.completed",
    providerEventId: providerEventFingerprint({
      source: "elevenlabs",
      eventId: String(
        (payload as { event_id?: unknown }).event_id ??
          `${conversationId}:post_call_transcription`,
      ),
    }),
    attemptRef: { conversationId },
    targetState: "completed",
    payload: { terminationReason, durationSec: durationSec ?? null },
  });

  await finalizeAIConversation({
    conversationId,
    turns,
    status: String(data.status ?? ""),
    durationSec,
    terminationReason,
    errorCode,
    errorReason,
  });

  return NextResponse.json({ received: true });
}
