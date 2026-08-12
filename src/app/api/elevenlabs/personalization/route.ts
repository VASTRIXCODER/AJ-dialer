import { NextResponse } from "next/server";
import { resolveAgentContext } from "@/lib/ai/agent-context";
import {
  findByCallSid,
  getAICall,
  registerAICall,
  updateAICall,
} from "@/lib/ai-call-store";
import { markAIConversationActive } from "@/lib/db/records";
import {
  NO_OVERRIDES,
  agentKeyForId,
  buildOverridePayload,
  elevenLabsConfig,
  fetchOverridePolicy,
  verifyWebhookSignature,
} from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);

/**
 * Conversation-initiation (personalization) webhook. ElevenLabs calls this as
 * the call connects; we return dynamic variables built from the matched lead so
 * the agent's script is personalized. Kept fast — Claude's heavy analysis runs
 * post-call, not here, to avoid call-setup latency.
 */
export async function POST(req: Request) {
  // Read the raw body so we can verify the ElevenLabs HMAC signature. A verified
  // request is trusted enough to enable the phone-number fallback in
  // resolveAgentContext; an unsigned/forged request is not, so it can only ever
  // resolve a call we actually registered (by conversationId/callSid) and can
  // never be used as a phone→PII / script-exfiltration oracle. Signing is only
  // enforced when ELEVENLABS_WEBHOOK_SECRET is set, so this never breaks a
  // deployment that hasn't enabled webhook signing — those requests simply lose
  // the last-resort personalization, not the call.
  const raw = await req.text();
  const signed =
    Boolean(elevenLabsConfig.webhookSecret) &&
    verifyWebhookSignature(raw, req.headers.get("elevenlabs-signature"));

  let body: Record<string, unknown>;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  const calledNumber = String(
    body.called_number ?? body.to_number ?? body.caller_id ?? "",
  );
  const callSid = String(body.call_sid ?? body.callSid ?? "");
  const conversationId = String(body.conversation_id ?? body.conversationId ?? "");
  // Which agent is calling? ElevenLabs includes agent_id in the init payload — map
  // it back to a persona so the second agent gets its own script, not Emily's.
  const agentIdRaw = String(body.agent_id ?? "");
  const agentKey = agentKeyForId(agentIdRaw);

  // Resolve the exact lead + organization THIS call belongs to. Every AI call in
  // this product is placed by us, so conversationId/callSid — set the instant we
  // placed the call — identify it exactly; phone-number matching is only a
  // guarded last resort inside resolveAgentContext, never the primary signal, so
  // two organizations that happen to share a homeowner's number can't cross-wire
  // (see the comment atop agent-context.ts for the incident this prevents).
  const { dynamicVariables, agentConfig, lead } = await resolveAgentContext({
    calledNumber,
    conversationId: conversationId || undefined,
    callSid: callSid || undefined,
    agentKey,
    allowPhoneFallback: signed,
  });

  // ── Who actually answered? ──────────────────────────────────────────────────
  // In BRIDGE mode the agent doesn't dial the homeowner — it dials our Twilio
  // bridge number, whose voice webhook answers instantly with a <Pause> (see
  // /api/twilio/voice). So this webhook fires a second or two after we place the
  // call, while the homeowner's phone has not even begun to ring.
  //
  // Treating that as "connected" was the original sin of the live monitor: every
  // bridge-mode call jumped straight to "In Progress" and sat there — the state
  // was a lie from the first second, not merely one that failed to clear. It also
  // made the real lifecycle unrepresentable, because a later (truthful) "ringing"
  // event from Twilio is a BACKWARDS move from in_progress and gets rejected.
  //
  // In bridge mode the only authority on "the homeowner picked up" is Twilio's
  // `answered` event on the customer leg (/api/twilio/status). So: say nothing.
  const bridge = elevenLabsConfig.bridgeNumber.trim();
  const isBridgeLeg = Boolean(bridge) && last10(calledNumber) === last10(bridge);

  // Keep the live monitor in sync — DIRECT mode only, where this webhook really
  // does mean the homeowner is on the line.
  if (!isBridgeLeg) {
    if (callSid) {
      const existing = findByCallSid(callSid);
      if (existing) {
        updateAICall(existing.conversationId, {
          state: "in_progress",
          connectedAt: Date.now(),
        });
      }
    }
    if (conversationId && !getAICall(conversationId) && lead) {
      registerAICall({
        conversationId,
        callSid: callSid || null,
        leadId: lead.id,
        leadName: `${lead.firstName} ${lead.lastName}`,
        phone: calledNumber,
        city: `${lead.city}, ${lead.state}`,
      });
      updateAICall(conversationId, {
        state: "in_progress",
        connectedAt: Date.now(),
      });
    }
    // Durable advance so the call shows as connected on every instance.
    if (conversationId) await markAIConversationActive(conversationId);
  }

  // Always return the personalization variables. Only send the override fields
  // THIS agent actually allows — a disallowed override here makes ElevenLabs
  // terminate the call the moment it connects. This is the same policy-gated build
  // as placeOutboundCall, keyed on the calling agent, so a second agent that runs
  // its own dashboard script (overrides OFF) simply gets no override and survives.
  const payload: Record<string, unknown> = {
    type: "conversation_initiation_client_data",
    dynamic_variables: dynamicVariables,
  };
  const policy = elevenLabsConfig.useDashboardPrompt
    ? NO_OVERRIDES
    : await fetchOverridePolicy({ agentId: agentIdRaw || undefined });
  const built = buildOverridePayload(
    {
      promptOverride: agentConfig.systemPrompt,
      firstMessage: agentConfig.firstMessage,
      language: agentConfig.language,
      voiceSpeed: agentConfig.voiceSpeed,
    },
    policy,
  );
  if (built.override) payload.conversation_config_override = built.override;
  return NextResponse.json(payload);
}
