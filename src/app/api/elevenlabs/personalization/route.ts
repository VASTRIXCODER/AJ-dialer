import { NextResponse } from "next/server";
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

  const dynamic_variables = lead
    ? {
        first_name: lead.firstName,
        full_name: `${lead.firstName} ${lead.lastName}`,
        city: lead.city,
        state: lead.state,
        utility_provider: lead.utilityProvider ?? "",
        utility_bill: lead.utilityBill ?? "",
        solar_provider: lead.solarProvider ?? "",
        solar_payment: lead.solarPayment ?? "",
      }
    : {};

  return NextResponse.json({
    type: "conversation_initiation_client_data",
    dynamic_variables,
  });
}
