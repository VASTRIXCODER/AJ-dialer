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
