import { NextResponse } from "next/server";
import {
  approveAppointment,
  approveAppointmentsBulk,
  cancelAppointment,
  createAppointment,
  deleteAppointment,
  rescheduleAppointment,
  setAppointmentStatus,
  updateAppointment,
} from "@/lib/db/appointments";
import {
  APPOINTMENT_STATUSES,
  CALLBACK_STATUSES,
  overrideLeadDisposition,
  routeAppointmentsBulk,
  setCallbackStatus,
} from "@/lib/db/dispositions";
import { retryNotification } from "@/lib/notifications/outbox";
import { getViewer } from "@/lib/org/membership";
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
 * Pipeline + calendar writes.
 *
 *  Appointments (all gated on `appointments.manage`):
 *   • appointment-create      — a booking with no call behind it
 *   • appointment-edit        — time / duration / notes / location / assignee
 *   • appointment-reschedule  — drag-and-drop's hot path
 *   • appointment-approve     — accept an AI proposal
 *   • appointment-cancel      — strike it, keep the history
 *   • appointment-delete      — genuinely remove it (a duplicate / a misfire)
 *   • appointment            — set status (completed / no_show / …)
 *   • appointment-bulk       — approve many, or route many back to a disposition
 *   • notification-retry     — re-queue an email that exhausted its retries
 *
 *  Pipeline (unchanged, ownership-checked in the db layer):
 *   • disposition — re-file a lead (override the AI)
 *   • callback    — set a callback's status
 *
 * ── The permission gate (ticket 7.2) ────────────────────────────────────────
 * `appointments.manage` is checked HERE for every appointment action, and again
 * inside src/lib/db/appointments.ts on every individual write. That is not
 * belt-and-braces for its own sake: the ticket's done-condition is that a
 * restricted account cannot reach any calendar-management function *including by
 * hand-crafting a POST to this route*. One gate in the UI would be theatre; one
 * gate here would still leave the db functions callable from anywhere else in the
 * app. So: both.
 *
 * `callback` and `disposition` are deliberately NOT gated on it. They're shared
 * with the Callbacks page and the leads table, where owning the row has always
 * been enough — gating them would silently break two other surfaces.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    leadId?: string;
    leadName?: string;
    outcome?: CallOutcome;
    /** The disposition-def key pressed (system key or `x_*` custom). */
    dispositionKey?: string;
    id?: string;
    status?: string;
    ids?: string[];
    op?: "approve" | "route";
    scheduledLabel?: string;
    scheduledAt?: string | null;
    durationMin?: number;
    location?: string;
    title?: string;
    assignedTo?: string;
    reason?: string;
    notes?: string;
    approve?: boolean;
  };

  const action = body.action ?? "";

  // Every appointment action passes through this one door.
  if (action.startsWith("appointment") || action === "notification-retry") {
    const viewer = await getViewer();
    if (!viewer.permissions.includes("appointments.manage")) {
      return NextResponse.json(
        { ok: false, error: "You don't have permission to manage appointments." },
        { status: 403 },
      );
    }

    if (action === "appointment-create") {
      const r = await createAppointment({
        leadId: body.leadId ?? null,
        leadName: body.leadName ?? "",
        scheduledAt: body.scheduledAt ?? null,
        scheduledLabel: body.scheduledLabel,
        durationMin: body.durationMin,
        location: body.location,
        notes: body.notes,
        title: body.title,
        assignedTo: body.assignedTo,
      });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "appointment-approve") {
      if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
      const r = await approveAppointment(body.id);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "appointment-edit") {
      if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
      const r = await updateAppointment(body.id, {
        scheduledAt: body.scheduledAt,
        scheduledLabel: body.scheduledLabel,
        durationMin: body.durationMin,
        location: body.location,
        title: body.title,
        assignedTo: body.assignedTo,
        notes: body.notes,
        approve: body.approve,
      });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "appointment-reschedule") {
      if (!body.id || !body.scheduledAt)
        return NextResponse.json(
          { error: "id and scheduledAt are required." },
          { status: 400 },
        );
      const r = await rescheduleAppointment(body.id, body.scheduledAt, body.durationMin);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "appointment-cancel") {
      if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
      const r = await cancelAppointment(body.id, body.reason);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "appointment-delete") {
      if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
      const r = await deleteAppointment(body.id);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "appointment-bulk") {
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

    if (action === "appointment") {
      if (!body.id || !body.status || !(APPOINTMENT_STATUSES as readonly string[]).includes(body.status))
        return NextResponse.json({ error: "id and a valid status are required." }, { status: 400 });
      const r = await setAppointmentStatus(body.id, body.status);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "notification-retry") {
      if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
      const r = await retryNotification(body.id, viewer.org?.id ?? null);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  if (action === "disposition") {
    if (!body.leadId || !body.outcome || !OUTCOMES.includes(body.outcome))
      return NextResponse.json({ error: "leadId and a valid outcome are required." }, { status: 400 });
    // Shape-guard only (system key or x_* slug) — an unknown key rides along on
    // the record as "the button that was pressed"; the canonical outcome above
    // is what everything acts on.
    const dispositionKey =
      typeof body.dispositionKey === "string" &&
      /^(x_)?[a-z0-9_]{1,64}$/.test(body.dispositionKey)
        ? body.dispositionKey
        : null;
    const r = await overrideLeadDisposition(body.leadId, body.outcome, dispositionKey);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (action === "callback") {
    if (!body.id || !body.status || !(CALLBACK_STATUSES as readonly string[]).includes(body.status))
      return NextResponse.json({ error: "id and a valid status are required." }, { status: 400 });
    const r = await setCallbackStatus(body.id, body.status);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
