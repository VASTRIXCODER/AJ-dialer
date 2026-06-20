import { NextResponse } from "next/server";
import { registerAICall } from "@/lib/ai-call-store";
import { getLeadById } from "@/lib/data";
import { isElevenLabsConfigured, placeOutboundCall } from "@/lib/elevenlabs";
import { toE164 } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Place an outbound AI call: ElevenLabs dials the homeowner through your Twilio
 * number, runs your agent script (personalized with the lead's data), records
 * it, and posts the transcript back to /api/elevenlabs/webhook.
 */
export async function POST(req: Request) {
  if (!isElevenLabsConfigured()) {
    return NextResponse.json(
      { error: "ElevenLabs is not configured", mode: "offline" },
      { status: 503 },
    );
  }

  const { leadId } = await req
    .json()
    .catch(() => ({}) as { leadId?: string });
  const lead = leadId ? getLeadById(leadId) : null;
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const toNumber = toE164(lead.phone);

  try {
    const result = await placeOutboundCall({
      toNumber,
      dynamicVariables: {
        first_name: lead.firstName,
        last_name: lead.lastName,
        full_name: `${lead.firstName} ${lead.lastName}`,
        city: lead.city,
        state: lead.state,
        utility_provider: lead.utilityProvider ?? "",
        utility_bill: lead.utilityBill ?? "",
        solar_provider: lead.solarProvider ?? "",
        solar_payment: lead.solarPayment ?? "",
      },
    });

    if (!result.conversationId) {
      return NextResponse.json(
        { error: "ElevenLabs did not return a conversation id", result },
        { status: 502 },
      );
    }

    registerAICall({
      conversationId: result.conversationId,
      callSid: result.callSid,
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`,
      phone: toNumber,
      city: `${lead.city}, ${lead.state}`,
    });

    return NextResponse.json({
      conversationId: result.conversationId,
      callSid: result.callSid,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
