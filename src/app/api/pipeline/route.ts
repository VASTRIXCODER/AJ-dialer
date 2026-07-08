import { NextResponse } from "next/server";
import {
  APPOINTMENT_STATUSES,
  CALLBACK_STATUSES,
  approveAppointment,
  approveAppointmentsBulk,
  deleteAppointment,
  overrideLeadDisposition,
  routeAppointmentsBulk,
  setAppointmentStatus,
  setCallbackStatus,
  updateAppointment,
} from "@/lib/db/dispositions";
import type { CallOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

const OUTCOMES: CallOutcome[] = [
  "appointment_booked",
  "callback_scheduled",
  "qualified",
  "not_interested",
  "bills_fine",
  "no_answer",
  "voicemail",
  "wrong_number",
  "do_not_call",
];

/**
 * Pipeline overrides from the Appointments / Callbacks tabs:
 *  • { action: "disposition", leadId, outcome } — re-file the lead (override AI).
 *  • { action: "appointment", id, status }      — set an appointment's status.
 *  • { action: "appointment-delete", id }       — permanently delete an appointment.
 *  • { action: "callback", id, status }         — set a callback's status.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    leadId?: string;
    outcome?: CallOutcome;
    id?: string;
    status?: string;
    ids?: string[];
    op?: "approve" | "route";
    scheduledLabel?: string;
    scheduledAt?: string | null;
    notes?: string;
    approve?: boolean;
  };

  if (body.action === "appointment-approve") {
    if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    const r = await approveAppointment(body.id);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (body.action === "appointment-edit") {
    if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    const r = await updateAppointment(body.id, {
      scheduledLabel: body.scheduledLabel,
      scheduledAt: body.scheduledAt,
      notes: body.notes,
      approve: body.approve,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (body.action === "appointment-delete") {
    if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    const r = await deleteAppointment(body.id);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (body.action === "appointment-bulk") {
    if (!Array.isArray(body.ids) || body.ids.length === 0)
      return NextResponse.json({ error: "ids are required." }, { status: 400 });
    if (body.op === "route") {
      if (!body.outcome || !OUTCOMES.includes(body.outcome))
        return NextResponse.json({ error: "A valid outcome is required." }, { status: 400 });
      const r = await routeAppointmentsBulk(body.ids, body.outcome);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    const r = await approveAppointmentsBulk(body.ids);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (body.action === "disposition") {
    if (!body.leadId || !body.outcome || !OUTCOMES.includes(body.outcome))
      return NextResponse.json({ error: "leadId and a valid outcome are required." }, { status: 400 });
    const r = await overrideLeadDisposition(body.leadId, body.outcome);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (body.action === "appointment") {
    if (!body.id || !body.status || !(APPOINTMENT_STATUSES as readonly string[]).includes(body.status))
      return NextResponse.json({ error: "id and a valid status are required." }, { status: 400 });
    const r = await setAppointmentStatus(body.id, body.status);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (body.action === "callback") {
    if (!body.id || !body.status || !(CALLBACK_STATUSES as readonly string[]).includes(body.status))
      return NextResponse.json({ error: "id and a valid status are required." }, { status: 400 });
    const r = await setCallbackStatus(body.id, body.status);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
