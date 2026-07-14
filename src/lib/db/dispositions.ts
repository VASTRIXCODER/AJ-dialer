import "server-only";

import type { CallOutcome } from "../types";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { apptScope } from "./appointments";
import { applyManualDisposition } from "./records";
import { canActOn, getScope } from "./scope";

// Human overrides for the Callbacks tab and the appointment review lane:
// re-disposition a lead (correcting what the AI filed) or update a callback's
// status. Every write is authorized against the actor's scope before it touches
// the DB.
//
// Appointment writes used to live here too. They moved to ./appointments.ts,
// which authorizes on the `appointments.manage` / `appointments.team` permissions
// rather than the role-derived `scope.supervisor` — see the header there for why.

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

export async function setCallbackStatus(id: string, status: string): Promise<Result> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return err("Not configured.");
  const scope = await getScope();
  if (!scope) return err("You must be signed in.");
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("callbacks")
    .select("id, owner_id, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return err("Item not found.");
  if (!canActOn(scope, row.owner_id as string, (row.org_id as string) ?? null))
    return err("You don't have access to change this item.");
  const { error } = await admin.from("callbacks").update({ status }).eq("id", id);
  return error ? err(error.message) : { ok: true };
}

type Row = Record<string, unknown>;

/**
 * Route many appointment proposals back to a single disposition (re-files each
 * lead — "these AI bookings aren't real, they're all not-interested").
 *
 * Gated on the appointment permissions rather than `scope.supervisor`, because
 * it is reached from the appointment review lane and rewrites appointment rows
 * as a side effect (routeDisposition cancels the lead's scheduled appointment).
 */
export async function routeAppointmentsBulk(ids: string[], outcome: CallOutcome): Promise<Result> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return err("Not configured.");
  const scope = await apptScope();
  if (!scope) return err("You must be signed in.");
  if (!scope.manage) return err("You don't have permission to manage appointments.");
  const list = ids.filter(Boolean).slice(0, 200);
  if (!list.length) return err("Nothing selected.");

  const admin = createAdminClient();
  const base = admin.from("appointments").select("id, lead_id, owner_id, org_id").in("id", list);
  // Narrow the SELECT itself: a rep re-routing a list of ids they don't own gets
  // back nothing, not somebody else's leads.
  let scoped =
    scope.team && scope.orgId ? base.eq("org_id", scope.orgId) : base.eq("owner_id", scope.userId);
  // A rep's "own" scope must stay within their CURRENT org — never touch
  // appointments they happen to own from an org they've since left.
  if (!scope.team && scope.orgId) scoped = scoped.eq("org_id", scope.orgId);
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
