import { NextResponse } from "next/server";
import { resolveAgentContextByPhone } from "@/lib/ai/agent-context";
import {
  findByCallSid,
  getAICall,
  registerAICall,
  updateAICall,
} from "@/lib/ai-call-store";
import { getLeadByPhoneAdmin } from "@/lib/db/leads";
import { markAIConversationActive } from "@/lib/db/records";
import { elevenLabsConfig } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);

/**
 * Conversation-initiation (personalization) webhook. ElevenLabs calls this as
 * the call connects; we return dynamic variables built from the matched lead so
 * the agent's script is personalized. Kept fast — Claude's heavy analysis runs
 * post-call, not here, to avoid call-setup latency.
 */
export async function POST(req: Request) {
  const body = (await req
    .json()
    .catch(() => ({}))) as Record<string, unknown>;

  const calledNumber = String(
    body.called_number ?? body.to_number ?? body.caller_id ?? "",
  );
  const callSid = String(body.call_sid ?? body.callSid ?? "");
  const conversationId = String(body.conversation_id ?? body.conversationId ?? "");

  // DB-backed (admin client, no user session needed) — this webhook only ever
  // fires for a real call ElevenLabs just placed, so there's nothing to "demo."
  const lead = await getLeadByPhoneAdmin(calledNumber);

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

  // Resolve the agent's prompt + voice from the matched lead's organization
  // (Sunrun/solar → the exact Emily script), plus personalization variables.
  const { dynamicVariables, agentConfig } =
    await resolveAgentContextByPhone(calledNumber);

  // Always return the personalization variables. Only return a prompt/voice
  // override when NOT in dashboard-prompt mode — a disallowed override here makes
  // ElevenLabs terminate the call the moment it connects.
  const payload: Record<string, unknown> = {
    type: "conversation_initiation_client_data",
    dynamic_variables: dynamicVariables,
  };
  if (!elevenLabsConfig.useDashboardPrompt) {
    payload.conversation_config_override = {
      agent: {
        prompt: { prompt: agentConfig.systemPrompt },
        first_message: agentConfig.firstMessage,
        language: agentConfig.language,
      },
      tts: { speed: agentConfig.voiceSpeed },
    };
  }
  return NextResponse.json(payload);
}
