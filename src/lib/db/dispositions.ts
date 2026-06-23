import "server-only";

import type { CallOutcome } from "../types";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { applyManualDisposition } from "./records";
import { canActOn, getScope } from "./scope";

// Human overrides for the Appointments / Callbacks tabs: re-disposition a lead
// (correcting what the AI filed) or update an appointment / callback's status.
// Every write is authorized against the actor's scope before it touches the DB.

type Result = { ok: boolean; error?: string };
const err = (error: string): Result => ({ ok: false, error });

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "completed",
  "no_show",
  "rescheduled",
  "cancelled",
] as const;
export const CALLBACK_STATUSES = ["due", "completed", "cancelled"] as const;

/** Re-file a lead under a human-chosen disposition (overrides the AI's). */
export async function overrideLeadDisposition(
  leadId: string,
  outcome: CallOutcome,
): Promise<Result> {
  if (!isSupabaseConfigured() || !isAdminConfigured())
    return err("Connect Supabase to change dispositions.");
  const scope = await getScope();
  if (!scope) return err("You must be signed in.");
  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, owner_id, org_id, first_name, last_name, phone")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return err("No lead is linked to this item, so it can't be re-dispositioned.");
  if (!canActOn(scope, lead.owner_id as string, (lead.org_id as string) ?? null))
    return err("You don't have access to change this item.");
  return applyManualDisposition(admin, {
    lead: lead as Parameters<typeof applyManualDisposition>[1]["lead"],
    outcome,
    actorLabel: scope.supervisor ? "Re-dispositioned by supervisor" : "Re-dispositioned by rep",
  });
}

async function setStatus(table: "appointments" | "callbacks", id: string, status: string): Promise<Result> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return err("Not configured.");
  const scope = await getScope();
  if (!scope) return err("You must be signed in.");
  const admin = createAdminClient();
  const { data: row } = await admin
    .from(table)
    .select("id, owner_id, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return err("Item not found.");
  if (!canActOn(scope, row.owner_id as string, (row.org_id as string) ?? null))
    return err("You don't have access to change this item.");
  const { error } = await admin.from(table).update({ status }).eq("id", id);
  return error ? err(error.message) : { ok: true };
}

export const setAppointmentStatus = (id: string, status: string) =>
  setStatus("appointments", id, status);
export const setCallbackStatus = (id: string, status: string) =>
  setStatus("callbacks", id, status);

type Row = Record<string, unknown>;

/** Load an appointment for a write + confirm the actor may touch it. */
async function authorizeAppointment(
  id: string,
): Promise<{ admin: ReturnType<typeof createAdminClient>; userId: string } | { error: string }> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return { error: "Not configured." };
  const scope = await getScope();
  if (!scope) return { error: "You must be signed in." };
  const admin = createAdminClient();
  const { data } = await admin
    .from("appointments")
    .select("owner_id, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { error: "Appointment not found." };
  if (!canActOn(scope, data.owner_id as string, (data.org_id as string) ?? null))
    return { error: "You don't have access to change this item." };
  return { admin, userId: scope.userId };
}

/** Approve a single AI-proposed appointment (the human accepts the booking). */
export async function approveAppointment(id: string): Promise<Result> {
  const auth = await authorizeAppointment(id);
  if ("error" in auth) return err(auth.error);
  const { error } = await auth.admin
    .from("appointments")
    .update({ approved: true, reviewed_by: auth.userId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  return error ? err(error.message) : { ok: true };
}

/** Edit an appointment's time/notes, optionally approving in the same step. */
export async function updateAppointment(
  id: string,
  patch: { scheduledLabel?: string; scheduledAt?: string | null; notes?: string; approve?: boolean },
): Promise<Result> {
  const auth = await authorizeAppointment(id);
  if ("error" in auth) return err(auth.error);
  const fields: Record<string, unknown> = {};
  if (patch.scheduledLabel != null) fields.scheduled_label = patch.scheduledLabel;
  if (patch.scheduledAt !== undefined) fields.scheduled_at = patch.scheduledAt || null;
  if (patch.notes != null) fields.notes = patch.notes;
  if (patch.approve) {
    fields.approved = true;
    fields.reviewed_by = auth.userId;
    fields.reviewed_at = new Date().toISOString();
  }
  if (Object.keys(fields).length === 0) return { ok: true };
  const { error } = await auth.admin.from("appointments").update(fields).eq("id", id);
  return error ? err(error.message) : { ok: true };
}

/** Approve many proposals at once (scoped to the actor). */
export async function approveAppointmentsBulk(ids: string[]): Promise<Result> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return err("Not configured.");
  const scope = await getScope();
  if (!scope) return err("You must be signed in.");
  const list = ids.filter(Boolean).slice(0, 500);
  if (!list.length) return err("Nothing selected.");
  const admin = createAdminClient();
  const base = admin
    .from("appointments")
    .update({ approved: true, reviewed_by: scope.userId, reviewed_at: new Date().toISOString() })
    .in("id", list);
  const q = scope.supervisor && scope.orgId ? base.eq("org_id", scope.orgId) : base.eq("owner_id", scope.userId);
  const { error } = await q;
  return error ? err(error.message) : { ok: true };
}

/** Route many proposals back to a single disposition (re-files each lead). */
export async function routeAppointmentsBulk(ids: string[], outcome: CallOutcome): Promise<Result> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return err("Not configured.");
  const scope = await getScope();
  if (!scope) return err("You must be signed in.");
  const list = ids.filter(Boolean).slice(0, 200);
  if (!list.length) return err("Nothing selected.");
  const admin = createAdminClient();
  const base = admin.from("appointments").select("id, lead_id, owner_id, org_id").in("id", list);
  const scoped = scope.supervisor && scope.orgId ? base.eq("org_id", scope.orgId) : base.eq("owner_id", scope.userId);
  const { data: appts } = await scoped;
  const leadIds = [
    ...new Set(((appts ?? []) as Row[]).map((a) => a.lead_id).filter(Boolean).map(String)),
  ];
  if (!leadIds.length) return err("No leads linked to the selected items.");
  const { data: leads } = await admin
    .from("leads")
    .select("id, owner_id, first_name, last_name, phone")
    .in("id", leadIds);
  for (const lead of (leads ?? []) as Row[]) {
    await applyManualDisposition(admin, {
      lead: lead as Parameters<typeof applyManualDisposition>[1]["lead"],
      outcome,
      actorLabel: "Bulk re-dispositioned by reviewer",
    });
  }
  return { ok: true };
}
