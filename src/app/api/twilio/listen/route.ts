import { NextResponse } from "next/server";
import { getAICall, updateAICall } from "@/lib/ai-call-store";
import { getAIConversation } from "@/lib/db/records";
import { fetchConversation, isElevenLabsConfigured } from "@/lib/elevenlabs";
import {
  isMediaStreamConfigured,
  mediaStreamBase,
  signListenToken,
} from "@/lib/media-stream";
import { getRestClient, isRestConfigured } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/** Resolve the underlying Twilio CallSid for a conversation (store → DB → API). */
async function resolveCallSid(conversationId: string): Promise<string | null> {
  let sid = getAICall(conversationId)?.callSid ?? null;
  if (!sid) sid = (await getAIConversation(conversationId))?.callSid ?? null;
  if (!sid && isElevenLabsConfigured())
    sid = (await fetchConversation(conversationId))?.callSid ?? null;
  return sid;
}

/**
 * Start (or stop) passive live-audio listening on an in-progress AI call. Uses
 * Twilio's Streams API to fork both legs' audio to the standalone media relay —
 * the AI is NOT interrupted. Returns a signed, short-lived listen URL the
 * supervisor's browser connects to.
 */
export async function POST(req: Request) {
  const { conversationId, action } = (await req.json().catch(() => ({}))) as {
    conversationId?: string;
    action?: "start" | "stop";
  };
  if (!conversationId)
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });

  if (!isMediaStreamConfigured())
    return NextResponse.json(
      { error: "Live audio isn't configured (set MEDIA_STREAM_URL + MEDIA_STREAM_SECRET)." },
      { status: 503 },
    );
  if (!isRestConfigured())
    return NextResponse.json(
      { error: "Twilio REST isn't configured — add your Twilio credentials." },
      { status: 503 },
    );

  const client = await getRestClient();
  if (!client)
    return NextResponse.json({ error: "Twilio REST unavailable." }, { status: 503 });

  const callSid = await resolveCallSid(conversationId);
  if (!callSid)
    return NextResponse.json(
      { error: "No live call leg found (it may have ended)." },
      { status: 404 },
    );

  // ── Stop listening ───────────────────────────────────────────────────────
  if (action === "stop") {
    const streamSid = getAICall(conversationId)?.streamSid;
    if (streamSid) {
      try {
        await client.calls(callSid).streams(streamSid).update({ status: "stopped" });
      } catch {
        /* stream may have already ended with the call */
      }
      updateAICall(conversationId, { streamSid: undefined });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Start listening ──────────────────────────────────────────────────────
  const room = `ls-${conversationId}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  const token = signListenToken(room);
  const base = mediaStreamBase();
  try {
    const stream = await client.calls(callSid).streams.create({
      url: `${base}/twilio?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`,
      track: "both_tracks",
    });
    updateAICall(conversationId, { streamSid: stream.sid });
    return NextResponse.json({
      ok: true,
      listenUrl: `${base}/listen?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start live audio." },
      { status: 502 },
    );
  }
}
