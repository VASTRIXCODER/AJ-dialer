import "server-only";

import { leads as fallbackLeads, getLeadById as fallbackById } from "../data";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { Lead, LeadStatus } from "../types";

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
  if (!isSupabaseConfigured()) return fallbackLeads;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fallbackLeads;
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("owner_id", user.id)
      .order("ai_score", { ascending: false, nullsFirst: false });
    if (error || !data) return fallbackLeads;
    return data.map(rowToLead);
  } catch {
    return fallbackLeads;
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
    if (data) return rowToLead(data);
    return fallbackById(id) ?? null;
  } catch {
    return fallbackById(id) ?? null;
  }
}

export async function getDialQueue(): Promise<Lead[]> {
  const all = await getLeads();
  return all
    .filter((l) => DIALABLE.includes(l.status) && l.phone)
    .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));
}
