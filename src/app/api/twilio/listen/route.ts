import { NextResponse } from "next/server";
import { getAICall, updateAICall } from "@/lib/ai-call-store";
import { getAIConversation } from "@/lib/db/records";
import { fetchConversation, isElevenLabsConfigured } from "@/lib/elevenlabs";
import {
  getHumanCall,
  setHumanStreamSid,
} from "@/lib/human-call-store";
import {
  isMediaStreamConfigured,
  mediaStreamBase,
  signListenToken,
} from "@/lib/media-stream";
import { getViewer, viewerCan } from "@/lib/org/membership";
import { getRestClient, isRestConfigured } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/** Resolve the underlying Twilio CallSid for an AI conversation (store → DB → API). */
async function resolveAICallSid(conversationId: string): Promise<string | null> {
  let sid = getAICall(conversationId)?.callSid ?? null;
  if (!sid) sid = (await getAIConversation(conversationId))?.callSid ?? null;
  if (!sid && isElevenLabsConfigured())
    sid = (await fetchConversation(conversationId))?.callSid ?? null;
  return sid;
}

/**
 * Start (or stop) passive live-audio listening on an in-progress call — either an
 * AI (ElevenLabs) conversation or a human rep↔customer call. Uses Twilio's
 * Streams API to fork the call's audio to the standalone relay without
 * interrupting it. Restricted to supervisors (monitor.listen) and scoped to the
 * viewer's organization.
 */
export async function POST(req: Request) {
  const { conversationId, humanId, action } = (await req
    .json()
    .catch(() => ({}))) as {
    conversationId?: string;
    humanId?: string;
    action?: "start" | "stop";
  };

  // Only supervisors may listen to live calls.
  if (!(await viewerCan("monitor.listen")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  // ── Human call ─────────────────────────────────────────────────────────────
  if (humanId) {
    const call = getHumanCall(humanId);
    if (!call)
      return NextResponse.json({ error: "Call not found (it may have ended)." }, { status: 404 });
    // Scope to the viewer's org — a supervisor can only listen to their own org.
    const viewer = await getViewer();
    if (!viewer.org || call.orgId !== viewer.org.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!call.callSid)
      return NextResponse.json({ error: "No live audio leg available yet." }, { status: 409 });

    const room = `lh-${humanId}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
    if (action === "stop") {
      if (call.streamSid) {
        try {
          await client.calls(call.callSid).streams(call.streamSid).update({ status: "stopped" });
        } catch {
          /* stream may have ended with the call */
        }
        setHumanStreamSid(humanId, undefined);
      }
      return NextResponse.json({ ok: true });
    }
    const token = signListenToken(room);
    const base = mediaStreamBase();
    try {
      const stream = await client.calls(call.callSid).streams.create({
        url: `${base}/twilio?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`,
        track: "both_tracks",
      });
      setHumanStreamSid(humanId, stream.sid);
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

  // ── AI conversation ──────────────────────────────────────────────────────────
  if (!conversationId)
    return NextResponse.json({ error: "conversationId or humanId required" }, { status: 400 });

  const callSid = await resolveAICallSid(conversationId);
  if (!callSid)
    return NextResponse.json({ error: "No live call leg found (it may have ended)." }, { status: 404 });

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
