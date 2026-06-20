import { NextResponse } from "next/server";
import { finalizeAIConversation } from "@/lib/ai-call-finalize";
import { getAICall, updateAICall } from "@/lib/ai-call-store";
import { getAIConversation } from "@/lib/db/records";
import {
  elevenLabsConfig,
  fetchConversation,
  isElevenLabsConfigured,
} from "@/lib/elevenlabs";
import { getRestClient, isRestConfigured } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Supervisor intervention on an AI call. ElevenLabs dials through the imported
 * Twilio number, so we act on the underlying Twilio CallSid — resolved from the
 * live store, then Supabase, then the ElevenLabs conversation itself (so it
 * works on any serverless instance, not just the one that placed the call).
 *   • "end"      → hang up the Twilio leg AND finalize + categorize the session,
 *                  so a call never hangs "live" forever.
 *   • "takeover" → redirect the homeowner to a human rep (drops the AI).
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

  // Resolve the Twilio CallSid + (lazily) the live conversation.
  let callSid = getAICall(conversationId)?.callSid ?? null;
  if (!callSid) {
    const owned = await getAIConversation(conversationId);
    callSid = owned?.callSid ?? null;
  }
  let convo = null;
  if (!callSid && isElevenLabsConfigured()) {
    convo = await fetchConversation(conversationId);
    callSid = convo?.callSid ?? null;
  }

  const client = isRestConfigured() ? await getRestClient() : null;

  // ── End: stop the carrier leg if we can, then always finalize the session ───
  if (action === "end") {
    let hungUp = false;
    if (callSid && client) {
      try {
        await client.calls(callSid).update({ status: "completed" });
        hungUp = true;
      } catch {
        /* leg may already be over — fall through and finalize anyway */
      }
    }

    if (!convo && isElevenLabsConfigured()) {
      convo = await fetchConversation(conversationId);
    }
    await finalizeAIConversation({
      conversationId,
      turns: convo?.turns ?? [],
      status: convo?.status || "ended",
      durationSec: convo?.durationSec ?? undefined,
      terminationReason: convo?.terminationReason || "ended_by_supervisor",
    });

    return NextResponse.json({
      ok: true,
      action,
      hungUp,
      ...(hungUp
        ? {}
        : { note: "Session ended & categorized. The carrier leg will drop on its own." }),
    });
  }

  // ── Take over: redirect the live Twilio leg to a human rep ──────────────────
  if (!callSid) {
    return NextResponse.json(
      {
        error:
          "No live Twilio leg found for this call (it may have already ended).",
      },
      { status: 404 },
    );
  }
  if (!isRestConfigured() || !client) {
    return NextResponse.json(
      { error: "Twilio REST is not configured — add your Twilio credentials." },
      { status: 503 },
    );
  }

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

  try {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${target.replace(/[<>&]/g, "")}</Dial></Response>`;
    await client.calls(callSid).update({ twiml });
    updateAICall(conversationId, { summary: `Transferred to ${target}` });
    return NextResponse.json({ ok: true, action, target });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
