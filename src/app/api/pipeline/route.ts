import { NextResponse } from "next/server";
import {
  APPOINTMENT_STATUSES,
  CALLBACK_STATUSES,
  overrideLeadDisposition,
  setAppointmentStatus,
  setCallbackStatus,
} from "@/lib/db/dispositions";
import type { CallOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

const OUTCOMES: CallOutcome[] = [
  "appointment_booked",
  "callback_scheduled",
  "qualified",
  "not_interested",
  "no_answer",
  "voicemail",
  "wrong_number",
  "do_not_call",
];

/**
 * Pipeline overrides from the Appointments / Callbacks tabs:
 *  • { action: "disposition", leadId, outcome } — re-file the lead (override AI).
 *  • { action: "appointment", id, status }      — set an appointment's status.
 *  • { action: "callback", id, status }         — set a callback's status.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    leadId?: string;
    outcome?: CallOutcome;
    id?: string;
    status?: string;
  };

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
