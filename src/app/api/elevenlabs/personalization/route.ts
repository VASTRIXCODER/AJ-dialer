import { NextResponse } from "next/server";
import { resolveAgentContextByPhone } from "@/lib/ai/agent-context";
import {
  findByCallSid,
  getAICall,
  registerAICall,
  updateAICall,
} from "@/lib/ai-call-store";
import { leads } from "@/lib/data";

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

  const lead = leads.find((l) => last10(l.phone) === last10(calledNumber)) ?? null;

  // Keep the live monitor in sync.
  if (callSid) {
    const existing = findByCallSid(callSid);
    if (existing) updateAICall(existing.conversationId, { state: "in_progress" });
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
    updateAICall(conversationId, { state: "in_progress" });
  }

  // Resolve the agent's prompt + voice from the matched lead's organization
  // (Sunrun/solar → the exact Emily script), plus personalization variables.
  const { dynamicVariables, agentConfig } =
    await resolveAgentContextByPhone(calledNumber);

  return NextResponse.json({
    type: "conversation_initiation_client_data",
    dynamic_variables: dynamicVariables,
    conversation_config_override: {
      agent: {
        prompt: { prompt: agentConfig.systemPrompt },
        first_message: agentConfig.firstMessage,
        language: agentConfig.language,
      },
      tts: { speed: agentConfig.voiceSpeed },
    },
  });
}
