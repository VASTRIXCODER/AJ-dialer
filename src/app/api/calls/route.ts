import { NextResponse } from "next/server";
import { analyzeCall } from "@/lib/ai/analyze-call";
import { insertCallRecord } from "@/lib/db/records";
import { storedLeadTimezone } from "@/lib/dialer/lead-timezone";
import { getViewer } from "@/lib/org/membership";
import { resolveDispositionByKey } from "@/lib/status";
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
    /** The disposition-def key the rep pressed — equal to `outcome` for the
     *  nine system rows, an `x_*` key for admin-created buttons. Validated
     *  against the org's resolved taxonomy below. */
    dispositionKey?: string;
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
    /**
     * The callback time the rep agreed, captured by the scheduling dialog on
     * "Callback". Optional — skipping it files a callback with no time, which is
     * what EVERY rep-scheduled callback did before this existed.
     */
    callback?: { iso?: string; when?: string; reason?: string } | null;
    /** Which campaign script (A/B) the rep was shown for this lead, if any. */
    scriptVariant?: string;
    /** Client-minted idempotency key — stable across outbox replays. */
    clientAttemptId?: string;
    /** Conference room for attempt resolution only (parallel non-winners). */
    attemptRoom?: string;
    /** The callback this dial was launched from (board claim→dial deep link).
     *  Filing the disposition completes that callback — the loop that never
     *  used to close. Must be a uuid; anything else is dropped. */
    callbackId?: string;
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

  const callback =
    body.outcome === "callback_scheduled" && body.callback
      ? {
          iso: body.callback.iso,
          when: body.callback.when ?? "",
          reason: body.callback.reason ?? "",
        }
      : null;

  // Validate the pressed button against the ORG's resolved disposition set. An
  // unknown key (a stale client after the admin deleted a custom row, or a
  // hand-crafted POST) degrades to null rather than failing the save — the
  // canonical `outcome` still lands either way, so no disposition is ever lost
  // to taxonomy drift.
  let dispositionKey: string | null = null;
  if (typeof body.dispositionKey === "string" && body.dispositionKey) {
    const viewer = await getViewer();
    const def = resolveDispositionByKey(
      viewer.org?.settings.dispositions,
      body.dispositionKey,
    );
    if (def) dispositionKey = def.key;
  }

  const recordId = await insertCallRecord({
    leadId: body.leadId ?? null,
    leadName: body.leadName,
    phone: body.phone,
    durationSec: body.durationSec,
    outcome: body.outcome,
    dispositionKey,
    channel: "human",
    callSid: body.callSid ?? null,
    room: body.room ?? null,
    notes: body.notes,
    appointment: appt,
    callback,
    scriptVariant,
    clientAttemptId:
      typeof body.clientAttemptId === "string" && body.clientAttemptId.length <= 64
        ? body.clientAttemptId
        : null,
    attemptRoom:
      typeof body.attemptRoom === "string" && /^hc-[\w-]{1,80}$/.test(body.attemptRoom)
        ? body.attemptRoom
        : null,
    callbackId:
      typeof body.callbackId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.callbackId)
        ? body.callbackId
        : null,
  });

  if (!recordId) {
    return NextResponse.json({ ok: false, error: "Failed to save call record." }, { status: 500 });
  }

  // Fire-and-forget: the F1 structured analysis pass. One generateJSON writes
  // typed artifacts (summary/facts/objections/… with confidence + evidence)
  // instead of the old free-form summary string; the summary artifact's text
  // still backfills call_records.summary so the archive can search it. In demo
  // mode (no key) analyzeCall persists NOTHING — no simulated intelligence
  // ever enters the permanent record. Doesn't block the disposition response.
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
          // Through the helper: the column has a schema default, so the raw
          // value is not evidence of a chosen zone (see storedLeadTimezone).
          timezone: storedLeadTimezone(row.timezone as string | null) ?? undefined,
        };
        // The lead's org, not the viewer's profile default — analyzeCall
        // resolves the vertical context and disposition policy from it.
        const viewer = await getViewer();
        const orgId = viewer.org?.id ?? (row.org_id ? String(row.org_id) : null);
        if (!orgId) return;
        await analyzeCall({
          callRecordId: recordId,
          orgId,
          lead,
          // Manual calls leave no transcript (Twilio records, it doesn't
          // transcribe) — the notes + duration ARE the evidence, and the
          // policy's reviewOnMissingTranscript decides what a proposal from
          // that thin evidence may do.
          transcriptTurns: null,
          outcome: body.outcome ?? null,
          notes: typeof body.notes === "string" ? body.notes.slice(0, 4000) : undefined,
          durationSec:
            typeof body.durationSec === "number" && Number.isFinite(body.durationSec)
              ? Math.max(0, Math.round(body.durationSec))
              : undefined,
          // AI summaries are appointment-only (product policy): a manual call
          // gets its summary generated & persisted exactly when it booked.
          includeSummary: body.outcome === "appointment_booked",
        });
      } catch {
        /* best-effort */
      }
    })();
  }

  return NextResponse.json({ ok: true, id: recordId });
}
