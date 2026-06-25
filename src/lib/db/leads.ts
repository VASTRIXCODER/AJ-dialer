import "server-only";

import { leads as fallbackLeads, getLeadById as fallbackById } from "../data";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
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
    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;

    // Read the SHARED org pool with the service-role client so every member sees
    // the same leads immediately, independent of RLS migration state. Scoped to
    // the viewer's org in app code (a user only ever gets their own org's leads).
    // Falls back to the session client (RLS, own leads) when no org / no service
    // role is configured.
    const reader = orgId && isAdminConfigured() ? createAdminClient() : supabase;

    if (!orgId) {
      const { data } = await reader
        .from("leads")
        .select("*")
        .eq("owner_id", user.id)
        .order("ai_score", { ascending: false, nullsFirst: false });
      return (data ?? []).map(rowToLead);
    }

    // Two simple queries (no .or — maximally compatible): the org pool, plus
    // ALL of the viewer's own leads regardless of org_id. The owner_id query is
    // the safety net — it restores the original owner-scoped behavior, so the
    // importer NEVER loses leads even if a lead's org_id is null or belongs to a
    // different org. Results are merged + deduped by id.
    const [orgRes, ownRes] = await Promise.all([
      reader.from("leads").select("*").eq("org_id", orgId),
      reader.from("leads").select("*").eq("owner_id", user.id),
    ]);
    const byId = new Map<string, Row>();
    for (const r of [...(orgRes.data ?? []), ...(ownRes.data ?? [])]) {
      byId.set(String((r as Row).id), r as Row);
    }
    return [...byId.values()]
      .map(rowToLead)
      .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));
  } catch {
    return [];
  }
}

/**
 * Delete leads by id (individual or bulk, up to thousands at a time).
 *
 * Two things make a large bulk delete reliable:
 *  1. BATCHING. A single `.in("id", [...])` puts every id into the PostgREST
 *     request URL; a few hundred UUIDs overflow the server's URL-length limit and
 *     the whole call fails with a 400 ("bad request"). We delete in small chunks
 *     so each request URL stays well within limits, run in bounded-parallel waves.
 *  2. SCOPE. The leads write RLS is owner-only, but a supervisor can SEE (and
 *     should be able to clear) the whole shared org pool. So when the viewer is in
 *     an org and a service role is available, we delete with the admin client
 *     scoped IN CODE to "this org's leads OR my own" — never another org's.
 *
 * Call records are preserved (lead_id is set null on delete) so reports stay intact.
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

    // De-dupe + keep only well-formed UUIDs (defends the PostgREST filter too).
    const ids = [...new Set(leadIds.filter((id) => UUID.test(id)))];
    if (!ids.length) return { deleted: 0, error: "No valid leads selected." };

    // Resolve the viewer's org so we can clear the SHARED pool, not just leads
    // this user personally owns. With an org + service role, use the admin client
    // and scope deletes in code; otherwise the session client (RLS → own leads).
    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const scopeByOrg = Boolean(orgId && UUID.test(orgId)) && isAdminConfigured();
    const client = scopeByOrg ? createAdminClient() : supabase;

    const CHUNK = 100; // keep each request URL small (≈4KB) — never hits the limit
    const WAVE = 8; // bounded parallelism so big deletes stay fast but safe
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) batches.push(ids.slice(i, i + CHUNK));

    let deleted = 0;
    let firstError: string | null = null;
    for (let w = 0; w < batches.length && !firstError; w += WAVE) {
      const wave = batches.slice(w, w + WAVE);
      const results = await Promise.all(
        wave.map((batch) => {
          const q = client.from("leads").delete().in("id", batch);
          // Admin client bypasses RLS, so scope to the viewer's reach in code.
          const scoped = scopeByOrg
            ? q.or(`org_id.eq.${orgId},owner_id.eq.${user.id}`)
            : q;
          return scoped.select("id");
        }),
      );
      for (const r of results) {
        if (r.error) firstError = firstError ?? r.error.message;
        else deleted += r.data?.length ?? 0;
      }
    }

    if (firstError && deleted === 0) return { deleted: 0, error: firstError };
    if (firstError)
      return { deleted, error: `Deleted ${deleted}, then hit an error: ${firstError}` };
    return { deleted };
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

const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);

/**
 * Look up a lead by id with the service-role client (no user session needed).
 * Used by the post-call pipeline (webhook), where the session client would see
 * nothing under RLS and the lead context would be lost.
 */
export async function getLeadByIdAdmin(id: string): Promise<Lead | null> {
  if (!isAdminConfigured() || !UUID.test(id)) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("leads")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ? rowToLead(data as Row) : null;
  } catch {
    return null;
  }
}

/** Resolve a lead by phone (last 10 digits) with the service-role client. */
export async function getLeadByPhoneAdmin(phone: string): Promise<Lead | null> {
  const digits = last10(phone);
  if (!isAdminConfigured() || digits.length < 10) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("leads")
      .select("*")
      .ilike("phone", `%${digits}%`)
      .limit(5);
    const hit = (data ?? []).find(
      (r) => last10(String((r as Row).phone)) === digits,
    );
    return hit ? rowToLead(hit as Row) : null;
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
