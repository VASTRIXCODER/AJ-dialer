import { NextResponse } from "next/server";
import { getAICall, updateAICall } from "@/lib/ai-call-store";
import { elevenLabsConfig } from "@/lib/elevenlabs";
import { getRestClient, isRestConfigured } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Supervisor intervention on a live AI call. Because ElevenLabs dials through
 * your Twilio number, we hold the Twilio CallSid and act on the live leg:
 *   • "takeover" → redirect the homeowner to a human rep (drops the AI)
 *   • "end"      → hang up the call
 */
export async function POST(req: Request) {
  const { conversationId, action, to } = (await req
    .json()
    .catch(() => ({}))) as {
    conversationId?: string;
    action?: "takeover" | "end";
    to?: string;
  };

  if (!conversationId || !action) {
    return NextResponse.json(
      { error: "conversationId and action are required" },
      { status: 400 },
    );
  }

  const call = getAICall(conversationId);
  if (!call?.callSid) {
    return NextResponse.json(
      { error: "No live Twilio leg for this conversation" },
      { status: 404 },
    );
  }

  if (!isRestConfigured()) {
    return NextResponse.json(
      { error: "Twilio REST is not configured" },
      { status: 503 },
    );
  }
  const client = await getRestClient();
  if (!client) {
    return NextResponse.json({ error: "Twilio unavailable" }, { status: 503 });
  }

  try {
    if (action === "end") {
      await client.calls(call.callSid).update({ status: "completed" });
      updateAICall(conversationId, { state: "completed", endedAt: Date.now() });
      return NextResponse.json({ ok: true, action });
    }

    // takeover
    const target = (to || elevenLabsConfig.transferNumber || "").trim();
    if (!target) {
      return NextResponse.json(
        {
          error:
            "No transfer target. Set ELEVENLABS_TRANSFER_NUMBER or pass `to` (E.164).",
        },
        { status: 400 },
      );
    }
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${target.replace(/[<>&]/g, "")}</Dial></Response>`;
    await client.calls(call.callSid).update({ twiml });
    updateAICall(conversationId, { summary: `Transferred to ${target}` });
    return NextResponse.json({ ok: true, action, target });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
