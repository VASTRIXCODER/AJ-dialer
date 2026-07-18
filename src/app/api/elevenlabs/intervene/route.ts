import { NextResponse } from "next/server";
import { finalizeAIConversation } from "@/lib/ai-call-finalize";
import { getAICall, updateAICall } from "@/lib/ai-call-store";
import { getAIConversation } from "@/lib/db/records";
import {
  elevenLabsConfig,
  fetchConversation,
  isElevenLabsConfigured,
} from "@/lib/elevenlabs";
import { viewerCan, viewerOrgId } from "@/lib/org/membership";
import { getRestClient, isRestConfigured } from "@/lib/twilio";

export const dynamic = "force-dynamic";

const xml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

/**
 * Supervisor intervention on an AI call. ElevenLabs dials through the imported
 * Twilio number, so we act on the underlying Twilio CallSid — resolved from the
 * live store, then Supabase, then the ElevenLabs conversation (works on any
 * serverless instance).
 *   • "takeover" → drop the AI and move the homeowner into a conference room the
 *                  rep's browser joins → the human takes the call live.
 *   • "transfer" → reroute the homeowner to the rep phone line (ELEVENLABS_
 *                  TRANSFER_NUMBER, default +1 469-301-8199).
 *   • "end"      → hang up the leg AND finalize + categorize the session.
 */
export async function POST(req: Request) {
  const { conversationId, action, to, room } = (await req
    .json()
    .catch(() => ({}))) as {
    conversationId?: string;
    action?: "takeover" | "transfer" | "end";
    to?: string;
    room?: string;
  };

  if (!conversationId || !action) {
    return NextResponse.json(
      { error: "conversationId and action are required" },
      { status: 400 },
    );
  }

  // Taking over / transferring / ending a live call is a supervisor action.
  if (!(await viewerCan("monitor.intervene")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orgId = await viewerOrgId();
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // In bridge (conference) mode the agent dials our bridge number, so callSid is
  // the AGENT leg and customerSid is the homeowner's leg in the same room. In the
  // direct mode there's a single leg (callSid = homeowner).
  //
  // The in-memory store is process-wide (not per-tenant — see ai-call-store.ts),
  // so a supervisor from a DIFFERENT org could otherwise hang up, transfer, or
  // take over this call just by knowing its conversationId. Fail closed: only
  // trust a stored entry when it's confirmed to belong to the caller's own org.
  const rawStored = getAICall(conversationId);
  if (rawStored && rawStored.orgId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const stored = rawStored;
  const customerSid = stored?.customerCallSid ?? null;
  const bridged = Boolean(customerSid);

  // Resolve the Twilio CallSid + (lazily) the live conversation.
  let callSid = stored?.callSid ?? null;
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

  // ── End: stop the carrier leg(s) if we can, then always finalize the session ─
  if (action === "end") {
    let hungUp = false;
    if (client) {
      // Hang up the homeowner first (ends the conference), then the agent leg.
      for (const sid of [customerSid, callSid].filter(Boolean) as string[]) {
        try {
          await client.calls(sid).update({ status: "completed" });
          hungUp = true;
        } catch {
          /* leg may already be over — finalize anyway */
        }
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

  // takeover + transfer act on the homeowner's leg (the agent leg in bridge mode
  // is separate). Need at least one live leg + REST.
  const homeownerSid = customerSid || callSid;
  if (!homeownerSid) {
    return NextResponse.json(
      { error: "No live Twilio leg found for this call (it may have already ended)." },
      { status: 404 },
    );
  }
  if (!isRestConfigured() || !client) {
    return NextResponse.json(
      { error: "Twilio REST is not configured — add your Twilio credentials." },
      { status: 503 },
    );
  }

  /** In bridge mode, drop the AI agent leg so it stops talking after handoff. */
  async function dropAgentLeg() {
    if (bridged && callSid && callSid !== homeownerSid && client) {
      try {
        await client.calls(callSid).update({ status: "completed" });
      } catch {
        /* agent leg may already be gone */
      }
    }
  }

  try {
    // ── Take over: AI → human. Move the homeowner into the rep's conference. ──
    // The homeowner leg is already answered, so this is a plain conference join —
    // identical TwiML to the rep's browser join (no answerOnBridge needed).
    if (action === "takeover") {
      const conf = (room || `to-${conversationId}`)
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 100);
      await client.calls(homeownerSid).update({
        twiml: xml(
          `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false">${conf}</Conference></Dial>`,
        ),
      });
      await dropAgentLeg();
      updateAICall(conversationId, { summary: "Taken over by a human rep" });
      return NextResponse.json({ ok: true, action, room: conf });
    }

    // ── Transfer: reroute the homeowner to the rep phone line. ────────────────
    const target = (to || elevenLabsConfig.transferNumber || "").trim();
    if (!target) {
      return NextResponse.json(
        { error: "No transfer number set. Configure ELEVENLABS_TRANSFER_NUMBER." },
        { status: 400 },
      );
    }
    await client.calls(homeownerSid).update({
      twiml: xml(`<Dial>${target.replace(/[<>&]/g, "")}</Dial>`),
    });
    await dropAgentLeg();
    updateAICall(conversationId, { summary: `Transferred to ${target}` });
    return NextResponse.json({ ok: true, action, target });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Make the most common Twilio failures actionable instead of cryptic.
    const friendly = /not.?in.?progress|21220/i.test(raw)
      ? "That call has already ended — nothing to take over."
      : /not.?found|20404/i.test(raw)
        ? "Couldn't control that call leg. Confirm your Twilio credentials own this call (the same account ElevenLabs dials through)."
        : raw;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
