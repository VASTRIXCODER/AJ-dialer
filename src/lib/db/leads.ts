import "server-only";

import { leads as fallbackLeads, getLeadById as fallbackById } from "../data";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { Lead, LeadStatus } from "../types";
import { isValidPhone, normalizePhone } from "../utils";

// Account-scoped lead access. When Supabase is configured and the user is signed
// in, reads come from their `leads` table (RLS-enforced); otherwise it falls
// back to the in-memory source so demo mode keeps working.

const DIALABLE: LeadStatus[] = ["new", "no_answer", "callback"];

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
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("owner_id", user.id)
      .order("ai_score", { ascending: false, nullsFirst: false });
    if (error || !data) return [];
    return data.map(rowToLead);
  } catch {
    return [];
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
  // Require a genuinely dialable phone (not just any truthy string) so leads
  // with placeholder/garbled numbers never enter the queue and produce a "+"
  // call attempt that Twilio rejects.
  return all
    .filter((l) => DIALABLE.includes(l.status) && isValidPhone(l.phone))
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
