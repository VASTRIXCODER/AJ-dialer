import "server-only";

import { type ApptScope, canActOnAppt } from "../appointments/access";
import { DEFAULT_DURATION_MIN } from "../appointments/time";
import { getViewer } from "../org/membership";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { getScope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// Every write to an appointment goes through this file, and every one of them
// goes through `canActOnAppt`. That is the point: it is the single choke point
// the permission gate cannot be routed around, so revoking someone's
// `appointments.manage` locks them out of the DATA, not just the buttons.
//
// The rule itself lives in ../appointments/access.ts — pure, so it can be
// unit-tested directly rather than inferred from whether a route returned 403.
// ─────────────────────────────────────────────────────────────────────────────

export { canActOnAppt, type ApptScope };

type Result = { ok: boolean; error?: string };
const err = (error: string): Result => ({ ok: false, error });

/** The actor, and what they're allowed to do with appointments. */
export async function apptScope(): Promise<ApptScope | null> {
  const scope = await getScope();
  if (!scope) return null;
  const viewer = await getViewer();
  return {
    userId: scope.userId,
    orgId: scope.orgId,
    manage: viewer.permissions.includes("appointments.manage"),
    team: viewer.permissions.includes("appointments.team"),
  };
}

/** Load an appointment for a write + confirm the actor may touch it. */
async function authorize(
  id: string,
): Promise<{ admin: ReturnType<typeof createAdminClient>; scope: ApptScope; row: Row } | { error: string }> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return { error: "Not configured." };
  const scope = await apptScope();
  if (!scope) return { error: "You must be signed in." };
  if (!scope.manage)
    return { error: "You don't have permission to manage appointments." };
  const admin = createAdminClient();
  const { data } = await admin
    .from("appointments")
    .select("id, owner_id, org_id, assigned_to, scheduled_at, status, reschedule_count")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { error: "Appointment not found." };
  const row = data as Row;
  if (!canActOnAppt(scope, row.owner_id as string, (row.org_id as string) ?? null))
    return { error: "You don't have access to change this appointment." };
  return { admin, scope, row };
}

type Row = Record<string, unknown>;

export interface CreateAppointmentInput {
  leadId?: string | null;
  leadName?: string;
  /** Floating wall-clock ("2026-07-14T18:00:00"). Null = booked with no time yet. */
  scheduledAt?: string | null;
  scheduledLabel?: string;
  durationMin?: number;
  location?: string;
  notes?: string;
  title?: string;
  /** Which rep runs the review. Defaults to the creator. */
  assignedTo?: string | null;
}

/**
 * Book an appointment that has no call behind it — a manager scheduling a review
 * by hand from the calendar. Every other appointment in the system is a
 * by-product of a disposition (see routeDisposition); this is the only way to
 * create one directly, which is why the calendar could not previously represent
 * a booking that didn't come from a phone call.
 */
export async function createAppointment(input: CreateAppointmentInput): Promise<Result> {
  if (!isSupabaseConfigured() || !isAdminConfigured())
    return err("Connect Supabase to create appointments.");
  const scope = await apptScope();
  if (!scope) return err("You must be signed in.");
  if (!scope.manage) return err("You don't have permission to manage appointments.");

  // Booking FOR someone else is a team action, not a personal one.
  const assignedTo = input.assignedTo || scope.userId;
  if (assignedTo !== scope.userId && !scope.team)
    return err("You can only book appointments for yourself.");

  const admin = createAdminClient();
  const { error } = await admin.from("appointments").insert({
    owner_id: assignedTo,
    assigned_to: assignedTo,
    created_by: scope.userId,
    org_id: scope.orgId,
    lead_id: input.leadId || null,
    lead_name: input.leadName ?? "",
    scheduled_at: input.scheduledAt || null,
    scheduled_label: input.scheduledLabel ?? "",
    duration_min: input.durationMin || DEFAULT_DURATION_MIN,
    location: input.location ?? "",
    notes: input.notes ?? "",
    title: input.title ?? "",
    source: "rep",
    status: "scheduled",
    // Created by a human, so it's real immediately — no review lane, and the
    // outbox trigger fires the "appointment set" email on insert.
    approved: true,
  });
  return error ? err(error.message) : { ok: true };
}

export interface UpdateAppointmentInput {
  scheduledAt?: string | null;
  scheduledLabel?: string;
  durationMin?: number;
  location?: string;
  notes?: string;
  title?: string;
  assignedTo?: string;
  approve?: boolean;
}

/** Edit an appointment's time / details, optionally approving in the same step. */
export async function updateAppointment(
  id: string,
  patch: UpdateAppointmentInput,
): Promise<Result> {
  const auth = await authorize(id);
  if ("error" in auth) return err(auth.error);
  const { admin, scope, row } = auth;

  const fields: Row = {};
  if (patch.scheduledLabel != null) fields.scheduled_label = patch.scheduledLabel;
  if (patch.notes != null) fields.notes = patch.notes;
  if (patch.title != null) fields.title = patch.title;
  if (patch.location != null) fields.location = patch.location;
  if (patch.durationMin != null)
    fields.duration_min = Math.max(5, Math.min(600, Math.round(patch.durationMin)));

  if (patch.assignedTo != null) {
    if (patch.assignedTo !== scope.userId && !scope.team)
      return err("You can only assign appointments to yourself.");
    fields.assigned_to = patch.assignedTo;
  }

  // A time change is a RESCHEDULE — remember what it used to be. The outbox
  // trigger reads scheduled_at changing to send the "moved" email.
  if (patch.scheduledAt !== undefined) {
    const next = patch.scheduledAt || null;
    const prev = (row.scheduled_at as string) ?? null;
    fields.scheduled_at = next;
    if (prev && next && !sameInstant(prev, next)) {
      fields.rescheduled_from = prev;
      fields.reschedule_count = Number(row.reschedule_count ?? 0) + 1;
    }
    // Re-opening a cancelled slot by giving it a new time puts it back on the
    // calendar rather than leaving a ghost the grid refuses to draw.
    if (row.status === "cancelled" && next) {
      fields.status = "scheduled";
      fields.cancel_reason = null;
    }
  }

  if (patch.approve) {
    fields.approved = true;
    fields.reviewed_by = scope.userId;
    fields.reviewed_at = new Date().toISOString();
  }

  if (Object.keys(fields).length === 0) return { ok: true };
  const { error } = await admin.from("appointments").update(fields).eq("id", id);
  return error ? err(error.message) : { ok: true };
}

/** Postgres hands back "+00"; the client hands back a naive string. Compare the digits. */
function sameInstant(a: string, b: string): boolean {
  const norm = (v: string) => v.replace(/(\+00(:00)?|Z)$/, "").replace(" ", "T").slice(0, 19);
  return norm(a) === norm(b);
}

/** Drag-to-reschedule: the calendar's hot path. Time (and maybe duration) only. */
export async function rescheduleAppointment(
  id: string,
  scheduledAt: string,
  durationMin?: number,
): Promise<Result> {
  if (!scheduledAt) return err("A new time is required.");
  return updateAppointment(id, { scheduledAt, durationMin, scheduledLabel: "" });
}

/** Approve a single AI-proposed appointment (the human accepts the booking). */
export async function approveAppointment(id: string): Promise<Result> {
  const auth = await authorize(id);
  if ("error" in auth) return err(auth.error);
  const { error } = await auth.admin
    .from("appointments")
    .update({
      approved: true,
      reviewed_by: auth.scope.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  return error ? err(error.message) : { ok: true };
}

/**
 * Cancel — the calendar's "delete". The row survives with a reason so the day it
 * occupied still tells the truth about what happened, and so the outbox can tell
 * the recipient the review is off.
 */
export async function cancelAppointment(id: string, reason?: string): Promise<Result> {
  const auth = await authorize(id);
  if ("error" in auth) return err(auth.error);
  const { error } = await auth.admin
    .from("appointments")
    .update({ status: "cancelled", cancel_reason: reason ?? "" })
    .eq("id", id);
  return error ? err(error.message) : { ok: true };
}

/** Set an appointment's status (completed / no-show / rescheduled / …). */
export async function setAppointmentStatus(id: string, status: string): Promise<Result> {
  const auth = await authorize(id);
  if ("error" in auth) return err(auth.error);
  const { error } = await auth.admin.from("appointments").update({ status }).eq("id", id);
  return error ? err(error.message) : { ok: true };
}

/**
 * Permanently remove an appointment. Kept for genuine mistakes — a duplicate, a
 * misfire — where a cancelled row would just be noise on the calendar forever.
 * Cancelling is the normal path; this is the escape hatch.
 */
export async function deleteAppointment(id: string): Promise<Result> {
  const auth = await authorize(id);
  if ("error" in auth) return err(auth.error);
  const { error } = await auth.admin.from("appointments").delete().eq("id", id);
  return error ? err(error.message) : { ok: true };
}

/** Approve many proposals at once (scoped to what the actor may actually touch). */
export async function approveAppointmentsBulk(ids: string[]): Promise<Result> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return err("Not configured.");
  const scope = await apptScope();
  if (!scope) return err("You must be signed in.");
  if (!scope.manage) return err("You don't have permission to manage appointments.");
  const list = ids.filter(Boolean).slice(0, 500);
  if (!list.length) return err("Nothing selected.");

  const admin = createAdminClient();
  const base = admin
    .from("appointments")
    .update({
      approved: true,
      reviewed_by: scope.userId,
      reviewed_at: new Date().toISOString(),
    })
    .in("id", list);
  // Narrow the UPDATE itself, so a rep can't approve the floor's proposals by
  // posting a list of ids they don't own.
  const q =
    scope.team && scope.orgId ? base.eq("org_id", scope.orgId) : base.eq("owner_id", scope.userId);
  const { error } = await q;
  return error ? err(error.message) : { ok: true };
}
