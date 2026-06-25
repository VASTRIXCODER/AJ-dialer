import { NextResponse } from "next/server";
import { resolveAgentConfig } from "@/lib/ai/agent-prompt";
import { registerAICall } from "@/lib/ai-call-store";
import { getLeadById } from "@/lib/db/leads";
import { seedAIConversation } from "@/lib/db/records";
import {
  agentVariablesForLead,
  aiConferenceRoom,
  elevenLabsConfig,
  isAIBridgeConfigured,
  isElevenLabsConfigured,
  placeOutboundCall,
} from "@/lib/elevenlabs";
import { nextCallerId } from "@/lib/dialer/rotation-server";
import { getViewer } from "@/lib/org/membership";
import { resolveDialerAccess } from "@/lib/org/settings";
import type { Lead } from "@/lib/types";
import {
  getPublicBaseUrl,
  getRestClient,
  isRestConfigured,
  twilioConfig,
} from "@/lib/twilio";
import { formatPhone, toE164 } from "@/lib/utils";

export const dynamic = "force-dynamic";

const xml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Bridge a freshly-placed AI call into a Twilio conference so it can be listened
 * to live with no media relay (parity with human calls). The agent dialed our
 * bridge number; we move that leg into the room, then dial the homeowner into
 * the same room. Returns the homeowner's leg SID (for later transfer/end), or
 * null if the bridge couldn't be set up (caller falls back to the direct call).
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bridgeIntoConference(opts: {
  agentCallSid: string;
  room: string;
  toNumber: string;
  record: boolean;
  base: string | null;
  /** Rotated caller ID for the homeowner leg (falls back to the env caller ID). */
  from?: string;
}): Promise<string | null> {
  const client = await getRestClient();
  if (!client) return null;
  const recAttr =
    opts.record && opts.base
      ? ` record="record-from-start" recordingStatusCallback="${escapeXml(`${opts.base}/api/twilio/status`)}"`
      : opts.record
        ? ' record="record-from-start"'
        : "";

  // Dial the homeowner into the room first (no dependency on the agent leg yet);
  // their hangup ends the conference.
  const customer = await client.calls.create({
    to: opts.toNumber,
    from: opts.from || twilioConfig.callerId,
    twiml: xml(
      `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false"${recAttr}>${escapeXml(opts.room)}</Conference></Dial>`,
    ),
  });

  // Move the agent leg into the same room. It's still ringing/answering our
  // bridge (held by the voice webhook's <Pause>), so a redirect can race ahead
  // of the answer — retry until Twilio accepts it (call reaches in-progress).
  const moveTwiml = xml(
    `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${escapeXml(opts.room)}</Conference></Dial>`,
  );
  for (let i = 0; i < 5; i++) {
    try {
      await client.calls(opts.agentCallSid).update({ twiml: moveTwiml });
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (i === 4 || !/21220|not.?in.?progress/i.test(msg)) throw e;
      await sleep(700);
    }
  }
  return customer.sid;
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : undefined;
};
const b = (v: unknown) => v === true || v === "true";

/** Build a Lead from whatever the user knows about an ad-hoc number. */
function adHocLead(phone: string, k: Record<string, unknown>): Lead {
  return {
    id: `manual-${Date.now().toString(36)}`,
    firstName: s(k.firstName),
    lastName: s(k.lastName),
    phone,
    email: s(k.email) || undefined,
    address: s(k.address),
    city: s(k.city),
    state: s(k.state),
    zip: s(k.zip),
    utilityProvider: s(k.utilityProvider),
    solarProvider: s(k.solarProvider),
    status: "new",
    campaignId: "",
    solarPayment: n(k.solarPayment),
    utilityBill: n(k.utilityBill),
    hasEV: b(k.hasEV),
    hasPool: b(k.hasPool),
    hasBattery: b(k.hasBattery),
    multipleSystems: false,
    notes: s(k.notes) || undefined,
    createdAt: new Date().toISOString(),
    timezone: "",
  };
}

/**
 * Place an outbound AI call. Accepts either a queued lead (`leadId`) or an
 * ad-hoc number (`phone` + whatever the user knows in `lead`). The agent is
 * personalized with whatever data is available and works with the rest.
 */
export async function POST(req: Request) {
  if (!isElevenLabsConfigured()) {
    return NextResponse.json(
      { error: "ElevenLabs is not configured", mode: "offline" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    leadId?: string;
    phone?: string;
    lead?: Record<string, unknown>;
  };

  let lead: Lead | null = body.leadId ? await getLeadById(body.leadId) : null;
  let leadId: string | null = lead ? body.leadId ?? null : null;

  if (!lead && body.phone) {
    lead = adHocLead(toE164(body.phone), body.lead ?? {});
    leadId = null; // ad-hoc — not a stored lead
  }

  if (!lead) {
    return NextResponse.json(
      { error: body.leadId ? "Lead not found" : "A phone number is required" },
      { status: 404 },
    );
  }

  const toNumber = toE164(lead.phone);
  if (toNumber.replace(/\D/g, "").length < 10) {
    return NextResponse.json(
      { error: "Enter a valid phone number." },
      { status: 400 },
    );
  }

  const leadName =
    `${lead.firstName} ${lead.lastName}`.trim() || formatPhone(toNumber);

  // Configure the AI agent from the caller's organization — Sunrun/solar uses
  // the exact Emily script; other orgs get their white-label prompt + voice.
  const viewer = await getViewer();

  // Gate the AI dialer server-side too: an org may have it off (premium lock) or
  // restrict it to managers+ (reps without `dialer.ai`). Mirrors the dialer UI.
  if (viewer.org) {
    const { aiEnabled } = resolveDialerAccess(
      viewer.org.settings.features,
      viewer.permissions.includes("dialer.ai"),
    );
    if (!aiEnabled) {
      return NextResponse.json(
        { error: "The AI dialer isn’t available for your role or plan." },
        { status: 403 },
      );
    }
  }

  const agent = resolveAgentConfig(viewer.org);

  // Caller-ID rotation: one number per call, from the org's shared pool. The
  // same counter drives manual + AI so the whole org rotates together.
  const rotatedFrom = await nextCallerId(viewer.org?.id, viewer.org?.settings);

  // Bridge mode: route the agent through our Twilio number so the call lives in
  // a conference anyone can listen to. The agent dials the bridge; we move it
  // into the room and dial the homeowner in. Needs Twilio REST + a caller ID.
  const bridge = isAIBridgeConfigured() && isRestConfigured();
  const dialTarget = bridge ? toE164(elevenLabsConfig.bridgeNumber) : toNumber;

  try {
    const result = await placeOutboundCall({
      toNumber: dialTarget,
      dynamicVariables: agentVariablesForLead(lead, { company: viewer.org?.name }),
      promptOverride: agent.systemPrompt,
      firstMessage: agent.firstMessage,
      language: agent.language,
      voiceSpeed: agent.voiceSpeed,
      // In bridge mode the homeowner sees the customer-leg caller ID (set below),
      // so only rotate the ElevenLabs number for DIRECT (non-bridge) calls.
      agentPhoneNumberId: bridge ? undefined : rotatedFrom || undefined,
    });

    if (!result.conversationId) {
      return NextResponse.json(
        { error: "ElevenLabs did not return a conversation id", result },
        { status: 502 },
      );
    }

    // Set up the conference (best-effort — fall back to the direct call audio).
    let room: string | undefined;
    let customerCallSid: string | undefined;
    if (bridge && result.callSid) {
      try {
        room = aiConferenceRoom(result.conversationId);
        const sid = await bridgeIntoConference({
          agentCallSid: result.callSid,
          room,
          toNumber,
          record: true,
          base: getPublicBaseUrl(req),
          from: rotatedFrom || undefined,
        });
        customerCallSid = sid ?? undefined;
      } catch {
        room = undefined; // bridge failed — listening will be unavailable
      }
    }

    registerAICall({
      conversationId: result.conversationId,
      callSid: result.callSid,
      leadId,
      leadName,
      phone: toNumber,
      city: [lead.city, lead.state].filter(Boolean).join(", "),
      room,
      customerCallSid,
    });

    await seedAIConversation({
      conversationId: result.conversationId,
      callSid: result.callSid,
      leadId,
      leadName,
      phone: toNumber,
    });

    return NextResponse.json({
      conversationId: result.conversationId,
      callSid: result.callSid,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = /document_not_found|not[_ ]found/i.test(message)
      ? " — Check ELEVENLABS_AGENT_PHONE_NUMBER_ID: it must be the ElevenLabs phone number ID (Conversational AI → Phone Numbers → the imported number), not the phone number itself. Visit /api/elevenlabs/phone-numbers to see the IDs."
      : "";
    return NextResponse.json({ error: message + hint }, { status: 502 });
  }
}
