import { NextResponse } from "next/server";
import { insertCallRecord } from "@/lib/db/records";
import { getCallSummary } from "@/lib/ai/services";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { CallOutcome, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Persist a human-dialed call disposition to the signed-in account. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    leadId?: string;
    leadName?: string;
    phone?: string;
    durationSec?: number;
    outcome?: CallOutcome;
    callSid?: string;
    room?: string;
  };

  const recordId = await insertCallRecord({
    leadId: body.leadId ?? null,
    leadName: body.leadName,
    phone: body.phone,
    durationSec: body.durationSec,
    outcome: body.outcome,
    channel: "human",
    callSid: body.callSid ?? null,
    room: body.room ?? null,
  });

  if (!recordId) {
    return NextResponse.json({ ok: false, error: "Failed to save call record." }, { status: 500 });
  }

  // Fire-and-forget: generate an AI summary from lead context + outcome and
  // back-fill it onto the record. Doesn't block the disposition response.
  if (body.leadId && body.outcome && isSupabaseConfigured()) {
    (async () => {
      try {
        const supabase = await createClient();
        const { data: row } = await supabase
          .from("leads")
          .select("*")
          .eq("id", body.leadId!)
          .maybeSingle();
        if (!row) return;
        const lead: Lead = {
          id: String(row.id ?? ""),
          firstName: String(row.first_name ?? ""),
          lastName: String(row.last_name ?? ""),
          phone: String(row.phone ?? body.phone ?? ""),
          email: row.email as string | undefined,
          address: String(row.address ?? ""),
          city: String(row.city ?? ""),
          state: String(row.state ?? ""),
          zip: String(row.zip ?? ""),
          utilityProvider: String(row.utility_provider ?? ""),
          solarProvider: String(row.solar_provider ?? ""),
          status: String(row.status ?? "new") as Lead["status"],
          campaignId: String(row.campaign_id ?? ""),
          solarPayment: row.solar_payment as number | undefined,
          utilityBill: row.utility_bill as number | undefined,
          hasEV: Boolean(row.has_ev),
          hasPool: Boolean(row.has_pool),
          hasBattery: Boolean(row.has_battery),
          multipleSystems: Boolean(row.multiple_systems),
          notes: row.notes as string | undefined,
          aiScore: row.ai_score as number | undefined,
          createdAt: String(row.created_at ?? ""),
          timezone: String(row.timezone ?? ""),
        };
        const result = await getCallSummary(lead, body.outcome!);
        if (result.data.executiveSummary) {
          await supabase
            .from("call_records")
            .update({ summary: result.data.executiveSummary })
            .eq("id", recordId);
        }
      } catch {
        /* best-effort */
      }
    })();
  }

  return NextResponse.json({ ok: true, id: recordId });
}
