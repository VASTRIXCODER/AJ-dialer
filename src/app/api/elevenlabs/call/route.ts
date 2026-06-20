import { NextResponse } from "next/server";
import { registerAICall } from "@/lib/ai-call-store";
import { getLeadById } from "@/lib/db/leads";
import { seedAIConversation } from "@/lib/db/records";
import {
  agentVariablesForLead,
  isElevenLabsConfigured,
  placeOutboundCall,
} from "@/lib/elevenlabs";
import type { Lead } from "@/lib/types";
import { formatPhone, toE164 } from "@/lib/utils";

export const dynamic = "force-dynamic";

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

  try {
    const result = await placeOutboundCall({
      toNumber,
      dynamicVariables: agentVariablesForLead(lead),
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
      leadId,
      leadName,
      phone: toNumber,
      city: [lead.city, lead.state].filter(Boolean).join(", "),
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
