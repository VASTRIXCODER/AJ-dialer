import "server-only";

import { leads as fallbackLeads, getLeadById as fallbackById } from "../data";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { Lead, LeadStatus } from "../types";
import { normalizePhone } from "../utils";

// Account-scoped lead access. When Supabase is configured and the user is signed
// in, reads come from their `leads` table (RLS-enforced); otherwise it falls
// back to the in-memory source so demo mode keeps working.

const DIALABLE: LeadStatus[] = ["new", "no_answer", "callback"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

function rowToLead(r: Row): Lead {
  const num = (v: unknown) => (v == null ? undefined : Number(v));
  return {
    id: String(r.id),
    firstName: (r.first_name as string) ?? "",
    lastName: (r.last_name as string) ?? "",
    phone: (r.phone as string) ?? "",
    email: (r.email as string) ?? undefined,
    address: (r.address as string) ?? "",
    city: (r.city as string) ?? "",
    state: (r.state as string) ?? "",
    zip: (r.zip as string) ?? "",
    utilityProvider: (r.utility_provider as string) ?? "",
    solarProvider: (r.solar_provider as string) ?? "",
    status: ((r.status as LeadStatus) ?? "new"),
    campaignId: (r.campaign_id as string) ?? "",
    assignedRepId: (r.assigned_rep_id as string) ?? undefined,
    solarPayment: num(r.solar_payment),
    utilityBill: num(r.utility_bill),
    hasEV: Boolean(r.has_ev),
    hasPool: Boolean(r.has_pool),
    hasBattery: Boolean(r.has_battery),
    multipleSystems: Boolean(r.multiple_systems),
    notes: (r.notes as string) ?? undefined,
    aiScore: r.ai_score == null ? undefined : Number(r.ai_score),
    timezone: (r.timezone as string) ?? "America/Los_Angeles",
    lastContactedAt: (r.last_contacted_at as string) ?? undefined,
    createdAt: (r.created_at as string) ?? new Date().toISOString(),
  };
}

export async function getLeads(): Promise<Lead[]> {
  // Bundled sample leads ONLY in demo mode (no Supabase). A configured
  // deployment never shows placeholder data — a fresh org reads as empty.
  if (!isSupabaseConfigured()) return fallbackLeads;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    // Shared org pool: read every lead in the viewer's organization, not just
    // the ones they personally imported. RLS lets any active org member read the
    // org's leads; solo users (no org) fall back to their own leads.
    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const base = supabase.from("leads").select("*");
    // Match the whole org pool OR the viewer's own leads. The owner_id fallback
    // is essential: leads imported before org_id was backfilled have a null
    // org_id, and an org-only filter would hide them from their importer.
    const scoped = orgId
      ? base.or(`org_id.eq.${orgId},owner_id.eq.${user.id}`)
      : base.eq("owner_id", user.id);
    const { data, error } = await scoped.order("ai_score", {
      ascending: false,
      nullsFirst: false,
    });
    if (error || !data) return [];
    return data.map(rowToLead);
  } catch {
    return [];
  }
}

/**
 * Delete leads by id. Scoped + authorized by RLS (a member can only delete leads
 * in their own org, and only supervisors may delete). Returns how many were
 * removed. Their call records are kept (lead_id is set null) so reports stay intact.
 */
export async function deleteLeads(
  leadIds: string[],
): Promise<{ deleted: number; error?: string }> {
  if (!isSupabaseConfigured())
    return { deleted: 0, error: "Connect Supabase to manage leads." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { deleted: 0, error: "You must be signed in." };
    const ids = leadIds.filter((id) => UUID.test(id));
    if (!ids.length) return { deleted: 0, error: "No valid leads selected." };
    const { data, error } = await supabase
      .from("leads")
      .delete()
      .in("id", ids)
      .select("id");
    if (error) return { deleted: 0, error: error.message };
    return { deleted: data?.length ?? 0 };
  } catch (e) {
    return { deleted: 0, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

export async function getLeadById(id: string): Promise<Lead | null> {
  if (!isSupabaseConfigured()) return fallbackById(id) ?? null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ? rowToLead(data) : null;
  } catch {
    return null;
  }
}

export async function getDialQueue(): Promise<Lead[]> {
  const all = await getLeads();
  // Show every lead with a plausibly-dialable number (10+ digits) so imported
  // leads reliably appear on the dialer. Exact E.164 normalization happens at
  // dial time (toE164); a genuinely un-dialable number is rejected there with a
  // clear message rather than being silently hidden from the rep here.
  return all
    .filter((l) => DIALABLE.includes(l.status) && l.phone.replace(/\D/g, "").length >= 10)
    .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));
}

export interface LeadInput {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  utilityProvider?: string;
  solarProvider?: string;
  status?: string;
  utilityBill?: number;
  solarPayment?: number;
  campaignId?: string;
  notes?: string;
}

/**
 * Bulk-insert leads for the signed-in account (CSV import).
 *
 * Phone numbers are normalized to E.164 server-side (defense in depth — the same
 * normalization the importer runs client-side) so stored data is clean and
 * dialable. Rows whose phone can't be normalized are still imported (data isn't
 * lost) but counted in `invalidPhone` so the UI can warn they won't be dialable.
 */
export async function insertLeads(
  rows: LeadInput[],
): Promise<{ inserted: number; invalidPhone: number; error?: string }> {
  if (!isSupabaseConfigured())
    return { inserted: 0, invalidPhone: 0, error: "Connect Supabase to save leads." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { inserted: 0, invalidPhone: 0, error: "You must be signed in." };

    let invalidPhone = 0;
    const payload = rows
      .filter((r) => (r.phone && r.phone.trim()) || r.firstName)
      .map((r) => {
        const rawPhone = (r.phone ?? "").trim();
        const normalized = normalizePhone(rawPhone);
        if (rawPhone && !normalized) invalidPhone++;
        return {
          owner_id: user.id,
          first_name: r.firstName ?? "",
          last_name: r.lastName ?? "",
          // Store the clean E.164 when we can; otherwise keep the original so
          // the lead still carries whatever the user uploaded.
          phone: normalized || rawPhone,
          email: r.email || null,
          address: r.address ?? "",
          city: r.city ?? "",
          state: r.state ?? "",
          zip: r.zip ?? "",
          utility_provider: r.utilityProvider ?? "",
          solar_provider: r.solarProvider ?? "",
          status: r.status ?? "new",
          utility_bill: r.utilityBill ?? null,
          solar_payment: r.solarPayment ?? null,
          campaign_id: r.campaignId ?? null,
          notes: r.notes || null,
        };
      });

    if (!payload.length)
      return { inserted: 0, invalidPhone, error: "No valid rows found." };

    const { error, count } = await supabase
      .from("leads")
      .insert(payload, { count: "exact" });
    if (error) return { inserted: 0, invalidPhone, error: error.message };
    return { inserted: count ?? payload.length, invalidPhone };
  } catch (e) {
    return {
      inserted: 0,
      invalidPhone: 0,
      error: e instanceof Error ? e.message : "Import failed.",
    };
  }
}

export async function getLeadStats() {
  const all = await getLeads();
  return {
    total: all.length,
    qualified: all.filter(
      (l) => l.status === "qualified" || l.status === "appointment",
    ).length,
    appointments: all.filter((l) => l.status === "appointment").length,
    avgScore: all.length
      ? Math.round(all.reduce((a, l) => a + (l.aiScore ?? 0), 0) / all.length)
      : 0,
  };
}
