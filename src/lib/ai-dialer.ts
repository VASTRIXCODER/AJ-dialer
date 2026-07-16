import "server-only";

import { resolveAgentConfig } from "./ai/agent-prompt";
import { armProbe, breakerStatus, recordProviderFailure } from "./ai-call-breaker";
import { registerAICall } from "./ai-call-store";
import { isQuotaMessage } from "./call-disposition";
import { seedAIConversation } from "./db/records";
import { nextCallerId } from "./dialer/rotation-server";
import {
  type AgentKey,
  agentVariablesForLead,
  aiConferenceRoom,
  elevenLabsConfig,
  fetchQuota,
  invalidateQuota,
  isAIBridgeConfigured,
  placeOutboundCall,
  resolveElevenLabsAgent,
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
  conversationId: string;
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

  // This leg — the homeowner's — is the ONLY thing in the system that knows
  // whether a real person picked up the phone. ElevenLabs cannot tell us: in
  // bridge mode it is talking to our own Twilio conference, which answered
  // instantly, so from its side every call "connects".
  //
  // We previously created this leg with no status callback and no timeout, and so
  // never learned that a call rang out. That is why a no-answer sat in the monitor
  // as "In Progress" until something force-closed it twelve minutes later.
  //
  // Only attach the callback when we have a publicly reachable origin — an
  // unreachable URL makes Twilio reject the create outright (21609 / 11200). On
  // localhost getPublicBaseUrl() returns null, so this silently degrades to the
  // old behavior; set NEXT_PUBLIC_APP_URL to a tunnel to exercise it locally.
  const statusCb = opts.base
    ? {
        // 30s, matching the human dial path. Twilio's default is 60s, so this
        // isn't fixing "rings forever" — it's tightening the no-answer window.
        timeout: 30,
        statusCallback: `${opts.base}/api/twilio/status?conversationId=${encodeURIComponent(opts.conversationId)}`,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      }
    : {};

  const customer = await client.calls.create({
    to: opts.toNumber,
    from: opts.from || twilioConfig.callerId,
    twiml: xml(
      `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false"${recAttr}>${escapeXml(opts.room)}</Conference></Dial>`,
    ),
    ...statusCb,
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
  /**
   * Set when the call was REFUSED before dialing (out of credits, breaker open).
   * Callers must stop the campaign rather than move to the next lead — every
   * further call would fail identically and burn a lead for nothing.
   */
  halted?: boolean;
  haltReason?: string;
}

/**
 * Place one outbound AI call for `lead` on behalf of `org`.
 *
 * @param org        the calling organization (drives agent persona + rotation pool)
 * @param repUserId  rotation counter key (a rep's id, or the org owner for cron)
 * @param lead       the lead to dial (must have a dialable phone)
 * @param baseUrl    public origin for recording callbacks (may be null)
 * @param record     record the conference (default true)
 * @param agentKey   which AI persona to dial as (default "primary")
 * @param excludedCallerIds  numbers the rep toggled off in the dialer's
 *   caller-ID picker; filtered out of the pool before rotation runs.
 */
export async function placeAiCallForLead(opts: {
  org: OrgFull | null;
  repUserId: string | null;
  lead: Lead;
  baseUrl: string | null;
  record?: boolean;
  agentKey?: AgentKey;
  excludedCallerIds?: string[] | null;
}): Promise<PlaceAiCallResult> {
  const { org, repUserId, lead, baseUrl } = opts;
  const record = opts.record !== false;
  const agentKey: AgentKey = opts.agentKey ?? "primary";

  const toNumber = toE164(lead.phone);
  if (toNumber.replace(/\D/g, "").length < 10) {
    return { conversationId: null, callSid: null, error: "Invalid phone number" };
  }
  const leadName = `${lead.firstName} ${lead.lastName}`.trim() || formatPhone(toNumber);

  // ── GUARDRAIL 1: the circuit breaker ───────────────────────────────────────
  // If recent calls all died on the provider's side, STOP. This sits in the
  // SHARED placement path on purpose: the unattended cron scheduler dials through
  // here too, so a guard that only lived in the interactive route would leave the
  // scheduler free to burn the whole book overnight.
  const breaker = breakerStatus();
  if (breaker.open) {
    return {
      conversationId: null,
      callSid: null,
      halted: true,
      haltReason: breaker.reason ?? "provider_error",
      error:
        `AI dialing is halted — recent calls all failed on the voice provider (${breaker.reason}). ` +
        `${breaker.message} Calls are blocked so they stop burning leads.`,
    };
  }
  if (breaker.halfOpen) armProbe(); // let one call through to test the water

  // ── GUARDRAIL 2: preflight credit check ────────────────────────────────────
  // Out of credits, the provider STILL places the call and only kills it after the
  // homeowner answers — they pick up, hear half a greeting, and get hung up on.
  // So the balance has to be checked BEFORE dialing. A null quota (couldn't read
  // it) must never block the floor; the post-call detection is the backstop.
  const quota = await fetchQuota();
  if (quota?.exhausted) {
    recordProviderFailure("provider_quota_exceeded", `0 of ${quota.limit} credits remaining.`);
    return {
      conversationId: null,
      callSid: null,
      halted: true,
      haltReason: "provider_quota_exceeded",
      error:
        "Out of ElevenLabs credits — refusing to dial. The provider would place the call, let the " +
        "homeowner answer, then hang up on them mid-greeting. Top up the balance." +
        (quota.resetsAt
          ? ` Allowance resets ${new Date(quota.resetsAt).toLocaleString()}.`
          : ""),
    };
  }

  // Which ElevenLabs agent + persona to dial as. `resolveElevenLabsAgent`
  // gracefully degrades "secondary" to the primary agent when none is configured.
  const el = resolveElevenLabsAgent(agentKey);
  const agent = resolveAgentConfig(org, el.key);
  // Caller-ID rotation + local presence, keyed on this rep/owner's counter.
  // Numbers the rep toggled off in the caller-ID picker are excluded first.
  const rotatedFrom = await nextCallerId(repUserId, org?.settings, toNumber, opts.excludedCallerIds);

  const bridge = isAIBridgeConfigured() && isRestConfigured();
  const dialTarget = bridge ? toE164(elevenLabsConfig.bridgeNumber) : toNumber;

  try {
    const result = await placeOutboundCall({
      toNumber: dialTarget,
      agentId: el.agentId,
      dynamicVariables: agentVariablesForLead(lead, { company: org?.name }),
      promptOverride: agent.systemPrompt,
      firstMessage: agent.firstMessage,
      language: agent.language,
      voiceSpeed: agent.voiceSpeed,
      // Direct mode: prefer the second agent's dedicated number when it has one,
      // else the normal rotation. Bridge mode dials the bridge (number unused here).
      agentPhoneNumberId: bridge
        ? undefined
        : (el.key === "secondary" && elevenLabsConfig.agentPhoneNumberId2
            ? el.agentPhoneNumberId
            : rotatedFrom) || undefined,
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
          conversationId: result.conversationId,
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
      // The homeowner's leg. The Twilio status webhook identifies itself by
      // CallSid, so without this the row can't be found when the query string is
      // missing and the no-answer event is dropped on the floor.
      customerCallSid: customerCallSid ?? null,
      // Records exactly which override fields went out, so a future "why did every
      // call die?" is answerable from the data alone.
      overrideMode: result.overrideMode,
    });

    return { conversationId: result.conversationId, callSid: result.callSid, room, customerCallSid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // The provider can also reject the dial outright when the balance is gone.
    // Trip the breaker so the rest of the batch doesn't even try.
    if (isQuotaMessage(message)) {
      invalidateQuota();
      recordProviderFailure("provider_quota_exceeded", message);
      return {
        conversationId: null,
        callSid: null,
        halted: true,
        haltReason: "provider_quota_exceeded",
        error: "Out of ElevenLabs credits — AI dialing halted. Top up the balance, then resume.",
      };
    }

    return { conversationId: null, callSid: null, error: message };
  }
}
