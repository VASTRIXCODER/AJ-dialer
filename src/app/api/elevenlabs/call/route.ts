import { NextResponse } from "next/server";
import { placeAiCallForLead } from "@/lib/ai-dialer";
import { getLeadById } from "@/lib/db/leads";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { getViewer } from "@/lib/org/membership";
import { resolveDialerAccess } from "@/lib/org/settings";
import type { Lead } from "@/lib/types";
import { getPublicBaseUrl } from "@/lib/twilio";
import { toE164 } from "@/lib/utils";

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
 * ad-hoc number (`phone` + whatever the user knows in `lead`). Shares its
 * placement core with the unattended scheduler via placeAiCallForLead().
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
  if (!lead && body.phone) {
    lead = adHocLead(toE164(body.phone), body.lead ?? {});
  }
  if (!lead) {
    return NextResponse.json(
      { error: body.leadId ? "Lead not found" : "A phone number is required" },
      { status: 404 },
    );
  }

  if (toE164(lead.phone).replace(/\D/g, "").length < 10) {
    return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
  }

  const viewer = await getViewer();

  // Gate the AI dialer server-side: an org may have it off (premium lock) or
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

  const result = await placeAiCallForLead({
    org: viewer.org,
    repUserId: viewer.user?.id ?? null,
    lead,
    baseUrl: getPublicBaseUrl(req),
  });

  // The placement layer REFUSED to dial (out of credits / breaker open). Pass
  // `halted` through so the dialer stops the whole campaign instead of marching
  // to the next lead — each further call would fail the same way and spend a real
  // homeowner for nothing. 402 = payment required, which is literally the case.
  if (result.halted) {
    return NextResponse.json(
      { error: result.error, halted: true, reason: result.haltReason },
      { status: result.haltReason === "provider_quota_exceeded" ? 402 : 503 },
    );
  }

  if (!result.conversationId) {
    const message = result.error ?? "ElevenLabs did not return a conversation id";
    const hint = /document_not_found|not[_ ]found/i.test(message)
      ? " — Check ELEVENLABS_AGENT_PHONE_NUMBER_ID: it must be the ElevenLabs phone number ID (Conversational AI → Phone Numbers → the imported number), not the phone number itself. Visit /api/elevenlabs/phone-numbers to see the IDs."
      : "";
    return NextResponse.json({ error: message + hint }, { status: 502 });
  }

  return NextResponse.json({
    conversationId: result.conversationId,
    callSid: result.callSid,
  });
}
