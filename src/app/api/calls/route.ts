import { NextResponse } from "next/server";
import { orgAIContext } from "@/lib/ai/org-context";
import { getCallSummary } from "@/lib/ai/services";
import { insertCallRecord } from "@/lib/db/records";
import { getViewer } from "@/lib/org/membership";
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
    notes?: string;
    /**
     * The slot the rep agreed with the homeowner, captured by the booking dialog
     * on "Appointment booked". Optional — a rep who skips it still books, the
     * appointment just carries no time (which is what EVERY rep booking did
     * before this existed, and why none of them could appear on a calendar).
     */
    appointment?: {
      when?: string;
      iso?: string;
      notes?: string;
      durationMin?: number;
      location?: string;
    } | null;
    /** Which campaign script (A/B) the rep was shown for this lead, if any. */
    scriptVariant?: string;
  };

  // Strict allowlist — the DB check constraint only admits null | 'a' | 'b',
  // so anything else must collapse to null rather than fail the whole insert.
  const scriptVariant =
    body.scriptVariant === "a" || body.scriptVariant === "b" ? body.scriptVariant : null;

  const appt =
    body.outcome === "appointment_booked" && body.appointment
      ? {
          when: body.appointment.when ?? "",
          iso: body.appointment.iso,
          notes: body.appointment.notes ?? "",
          durationMin: body.appointment.durationMin,
          location: body.appointment.location,
        }
      : null;

  const recordId = await insertCallRecord({
    leadId: body.leadId ?? null,
    leadName: body.leadName,
    phone: body.phone,
    durationSec: body.durationSec,
    outcome: body.outcome,
    channel: "human",
    callSid: body.callSid ?? null,
    room: body.room ?? null,
    notes: body.notes,
    appointment: appt,
    scriptVariant,
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
        // Summarize with the org's actual vertical/vocabulary — the last
        // remaining solar-default caller after P6.AIADAPT.
        const viewer = await getViewer();
        const ctx = orgAIContext(viewer.org);
        const result = await getCallSummary(lead, body.outcome!, ctx.isSolar, undefined, ctx);
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
