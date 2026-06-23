import { NextResponse } from "next/server";
import { getAICall, updateAICall } from "@/lib/ai-call-store";
import { getAIConversation } from "@/lib/db/records";
import { fetchConversation, isElevenLabsConfigured } from "@/lib/elevenlabs";
import { getHumanCall } from "@/lib/human-call-store";
import {
  isMediaStreamConfigured,
  mediaStreamBase,
  signListenToken,
} from "@/lib/media-stream";
import { getViewer, viewerCan } from "@/lib/org/membership";
import {
  getRestClient,
  isRestConfigured,
  signMonitorToken,
} from "@/lib/twilio";

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
 * Authorize (or stop) passive live-listening on an in-progress call.
 *
 *  • Human rep↔customer call (`humanId`) → conference monitoring: the supervisor's
 *    browser joins the rep's Twilio conference MUTED. We just verify permission +
 *    org, then hand back the room name and a signed token the browser presents to
 *    the voice webhook. No media relay, no Twilio REST stream — nothing to host.
 *  • AI (ElevenLabs) conversation (`conversationId`) → relay path: fork the call's
 *    audio via Twilio Streams to the standalone relay (requires MEDIA_STREAM_*).
 *
 * Restricted to supervisors (monitor.listen) and scoped to the viewer's org.
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

  // ── Human call → conference monitoring (no relay) ────────────────────────────
  if (humanId) {
    // Stopping is fully client-side (the supervisor disconnects their own leg).
    if (action === "stop") return NextResponse.json({ ok: true });

    const call = await getHumanCall(humanId);
    if (!call)
      return NextResponse.json({ error: "Call not found (it may have ended)." }, { status: 404 });
    // Scope to the viewer's org — a supervisor can only listen to their own org.
    const viewer = await getViewer();
    if (!viewer.org || call.orgId !== viewer.org.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // The room the rep's call joined (see use-dialer); token authorizes the muted
    // join at the voice webhook so only vetted supervisors can listen silently.
    const room = `hc-${humanId}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
    const token = signMonitorToken(room);
    if (!token)
      return NextResponse.json(
        { error: "Twilio isn't configured for live listening." },
        { status: 503 },
      );
    return NextResponse.json({ ok: true, room, token });
  }

  // ── AI conversation → relay path (requires the standalone media relay) ───────
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
