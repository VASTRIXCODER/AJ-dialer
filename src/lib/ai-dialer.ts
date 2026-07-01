import "server-only";

import { resolveAgentConfig } from "./ai/agent-prompt";
import { registerAICall } from "./ai-call-store";
import { seedAIConversation } from "./db/records";
import { nextCallerId } from "./dialer/rotation-server";
import {
  agentVariablesForLead,
  aiConferenceRoom,
  elevenLabsConfig,
  isAIBridgeConfigured,
  placeOutboundCall,
} from "./elevenlabs";
import type { OrgFull } from "./org/membership";
import { getRestClient, isRestConfigured, twilioConfig } from "./twilio";
import type { Lead } from "./types";
import { formatPhone, toE164 } from "./utils";

// ─────────────────────────────────────────────────────────────────────────────
// Shared AI-call placement. One code path for BOTH the interactive dialer
// (/api/elevenlabs/call) and the unattended scheduler (/api/cron/auto-dial), so
// automated calls behave exactly like a rep-launched AI call — same agent
// persona, caller-ID rotation, local presence, bridge/recording, and live
// monitor registration.
// ─────────────────────────────────────────────────────────────────────────────

const xml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
const escapeXml = (str: string) =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bridge a freshly-placed AI call into a Twilio conference so it can be listened
 * to live with no media relay (parity with human calls). Returns the homeowner's
 * leg SID, or null if the bridge couldn't be set up.
 */
async function bridgeIntoConference(opts: {
  agentCallSid: string;
  room: string;
  toNumber: string;
  record: boolean;
  base: string | null;
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

  const customer = await client.calls.create({
    to: opts.toNumber,
    from: opts.from || twilioConfig.callerId,
    twiml: xml(
      `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false"${recAttr}>${escapeXml(opts.room)}</Conference></Dial>`,
    ),
  });

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

export interface PlaceAiCallResult {
  conversationId: string | null;
  callSid: string | null;
  room?: string;
  customerCallSid?: string;
  error?: string;
}

/**
 * Place one outbound AI call for `lead` on behalf of `org`.
 *
 * @param org        the calling organization (drives agent persona + rotation pool)
 * @param repUserId  rotation counter key (a rep's id, or the org owner for cron)
 * @param lead       the lead to dial (must have a dialable phone)
 * @param baseUrl    public origin for recording callbacks (may be null)
 * @param record     record the conference (default true)
 */
export async function placeAiCallForLead(opts: {
  org: OrgFull | null;
  repUserId: string | null;
  lead: Lead;
  baseUrl: string | null;
  record?: boolean;
}): Promise<PlaceAiCallResult> {
  const { org, repUserId, lead, baseUrl } = opts;
  const record = opts.record !== false;

  const toNumber = toE164(lead.phone);
  if (toNumber.replace(/\D/g, "").length < 10) {
    return { conversationId: null, callSid: null, error: "Invalid phone number" };
  }
  const leadName = `${lead.firstName} ${lead.lastName}`.trim() || formatPhone(toNumber);

  const agent = resolveAgentConfig(org);
  // Caller-ID rotation + local presence, keyed on this rep/owner's counter.
  const rotatedFrom = await nextCallerId(repUserId, org?.settings, toNumber);

  const bridge = isAIBridgeConfigured() && isRestConfigured();
  const dialTarget = bridge ? toE164(elevenLabsConfig.bridgeNumber) : toNumber;

  try {
    const result = await placeOutboundCall({
      toNumber: dialTarget,
      dynamicVariables: agentVariablesForLead(lead, { company: org?.name }),
      promptOverride: agent.systemPrompt,
      firstMessage: agent.firstMessage,
      language: agent.language,
      voiceSpeed: agent.voiceSpeed,
      agentPhoneNumberId: bridge ? undefined : rotatedFrom || undefined,
    });

    if (!result.conversationId) {
      return { conversationId: null, callSid: result.callSid, error: "No conversation id returned" };
    }

    let room: string | undefined;
    let customerCallSid: string | undefined;
    if (bridge && result.callSid) {
      try {
        room = aiConferenceRoom(result.conversationId);
        const sid = await bridgeIntoConference({
          agentCallSid: result.callSid,
          room,
          toNumber,
          record,
          base: baseUrl,
          from: rotatedFrom || undefined,
        });
        customerCallSid = sid ?? undefined;
      } catch {
        room = undefined; // bridge failed — call still connects, just no live-listen
      }
    }

    registerAICall({
      conversationId: result.conversationId,
      callSid: result.callSid,
      leadId: lead.id.startsWith("manual-") ? null : lead.id,
      leadName,
      phone: toNumber,
      city: [lead.city, lead.state].filter(Boolean).join(", "),
      room,
      customerCallSid,
    });

    await seedAIConversation({
      conversationId: result.conversationId,
      callSid: result.callSid,
      leadId: lead.id.startsWith("manual-") ? null : lead.id,
      leadName,
      phone: toNumber,
    });

    return { conversationId: result.conversationId, callSid: result.callSid, room, customerCallSid };
  } catch (err) {
    return {
      conversationId: null,
      callSid: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
