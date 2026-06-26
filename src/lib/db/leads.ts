import "server-only";

import { leads as fallbackLeads, getLeadById as fallbackById } from "../data";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { fetchAllRows } from "../supabase/paginate";
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
    ownerId: (r.owner_id as string) ?? undefined,
  };
}

/** Is this profile role a supervisor (sees the whole org, not just own leads)? */
function isSupervisorRole(role: unknown): boolean {
  return ["owner", "admin", "manager"].includes(String(role ?? "rep"));
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
      .select("org_id, role")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const supervisor =
      Boolean(orgId) && isSupervisorRole(prof?.role) && isAdminConfigured();

    // Leads are SEPARATED BY UPLOADER. A rep sees only the leads they uploaded;
    // a supervisor (owner/admin/manager) sees the whole org, attributed to each
    // uploader so the Leads tab can group them into per-account sections.
    if (!supervisor) {
      // Page past PostgREST's 1,000-row ceiling so every uploaded lead is read.
      const data = await fetchAllRows<Row>((from, to) =>
        supabase
          .from("leads")
          .select("*")
          .eq("owner_id", user.id)
          .order("ai_score", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(from, to),
      );
      return data.map(rowToLead);
    }

    // Supervisor: the org pool + their own leads (covers any legacy null-org
    // rows), deduped, with each uploader's display name resolved for sections.
    // Both lead reads page past the 1,000-row ceiling.
    const admin = createAdminClient();
    const [orgRows, ownRows, memberRes] = await Promise.all([
      fetchAllRows<Row>((from, to) =>
        admin
          .from("leads")
          .select("*")
          .eq("org_id", orgId as string)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<Row>((from, to) =>
        admin
          .from("leads")
          .select("*")
          .eq("owner_id", user.id)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      admin
        .from("organization_members")
        .select("user_id,name")
        .eq("org_id", orgId as string)
        .eq("status", "active"),
    ]);
    const nameById = new Map(
      ((memberRes.data ?? []) as Row[]).map((m) => [
        String(m.user_id),
        String(m.name ?? ""),
      ]),
    );
    const byId = new Map<string, Row>();
    for (const r of [...orgRows, ...ownRows]) {
      byId.set(String(r.id), r);
    }
    return [...byId.values()]
      .map(rowToLead)
      .map((l) => ({
        ...l,
        ownerName: l.ownerId ? nameById.get(l.ownerId) || "" : "",
      }))
      .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));
  } catch {
    return [];
  }
}

/**
 * The whole org's shared lead pool, for ANY active member (reps included) — the
 * "Org pool" view where a rep can browse leads and claim ones to their own name.
 * Reads are org-scoped and attributed with each uploader's display name. A rep's
 * DEFAULT Leads view stays own-only (getLeads); this is the opt-in pool browse.
 */
export async function getOrgPoolLeads(): Promise<Lead[]> {
  if (!isSupabaseConfigured()) return [];
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
    if (!orgId) return [];

    // Org members can read the shared pool under RLS; use the admin client when
    // available for the org-wide read + uploader names (same as the supervisor
    // path), otherwise fall back to the RLS-scoped session client.
    const admin = isAdminConfigured() ? createAdminClient() : null;
    const reader = admin ?? supabase;
    const [rows, memberRes] = await Promise.all([
      fetchAllRows<Row>((from, to) =>
        reader
          .from("leads")
          .select("*")
          .eq("org_id", orgId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      admin
        ? admin
            .from("organization_members")
            .select("user_id,name")
            .eq("org_id", orgId)
            .eq("status", "active")
        : Promise.resolve({ data: [] as Row[] }),
    ]);
    const nameById = new Map(
      ((memberRes.data ?? []) as Row[]).map((m) => [
        String(m.user_id),
        String(m.name ?? ""),
      ]),
    );
    return rows
      .map(rowToLead)
      .map((l) => ({
        ...l,
        ownerName: l.ownerId ? nameById.get(l.ownerId) || "" : "",
      }))
      .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));
  } catch {
    return [];
  }
}

/**
 * Claim leads to the signed-in user (assign them to my own name). Available to
 * ANY active org member — RLS permits an org member to set owner_id to themselves
 * on a lead in their org — so a rep can pull shared-pool leads into their own
 * queue. Scoped to the caller's org; batched like reassign so big claims don't
 * overflow the request URL.
 */
export async function claimLeads(
  leadIds: string[],
): Promise<{ updated: number; error?: string }> {
  if (!isSupabaseConfigured())
    return { updated: 0, error: "Connect Supabase to manage leads." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { updated: 0, error: "You must be signed in." };
    const ids = [...new Set(leadIds.filter((id) => UUID.test(id)))];
    if (!ids.length) return { updated: 0, error: "No valid leads selected." };

    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    if (!orgId)
      return { updated: 0, error: "Join an organization to claim leads." };

    let updated = 0;
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("leads")
        .update({ owner_id: user.id, org_id: orgId })
        .in("id", batch)
        .eq("org_id", orgId) // never claim leads outside my org
        .select("id");
      if (error) return { updated, error: error.message };
      updated += data?.length ?? 0;
    }
    return { updated };
  } catch (e) {
    return { updated: 0, error: e instanceof Error ? e.message : "Claim failed." };
  }
}

// Statuses a supervisor may bulk-set for list hygiene. (Pipeline statuses like
// "appointment" come from real dispositions, never a bulk action.)
export const BULK_SETTABLE_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "not_interested",
  "dnc",
];

/**
 * Bulk-set a status on the selected leads (list hygiene — e.g. mark Do Not Call
 * or reset to New). Supervisor action; scoped like deleteLeads to "this org's
 * leads OR my own" via the admin client, batched so big updates never overflow
 * the request URL.
 */
export async function setLeadsStatus(
  leadIds: string[],
  status: LeadStatus,
): Promise<{ updated: number; error?: string }> {
  if (!isSupabaseConfigured())
    return { updated: 0, error: "Connect Supabase to manage leads." };
  if (!BULK_SETTABLE_STATUSES.includes(status))
    return { updated: 0, error: "That status can't be set in bulk." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { updated: 0, error: "You must be signed in." };
    const ids = [...new Set(leadIds.filter((id) => UUID.test(id)))];
    if (!ids.length) return { updated: 0, error: "No valid leads selected." };

    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const scopeByOrg = Boolean(orgId && UUID.test(orgId)) && isAdminConfigured();
    const client = scopeByOrg ? createAdminClient() : supabase;

    let updated = 0;
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const q = client.from("leads").update({ status }).in("id", batch);
      const scoped = scopeByOrg
        ? q.or(`org_id.eq.${orgId},owner_id.eq.${user.id}`)
        : q;
      const { data, error } = await scoped.select("id");
      if (error) return { updated, error: error.message };
      updated += data?.length ?? 0;
    }
    return { updated };
  } catch (e) {
    return { updated: 0, error: e instanceof Error ? e.message : "Update failed." };
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

/**
 * Reassign leads to a different uploader (move them between accounts). Supervisor-
 * only and strictly scoped to the viewer's org — you can never move another org's
 * leads, and the target must be an active member of your org. Batched like delete
 * so big moves don't overflow the request URL. Changes owner_id, so the leads
 * move into the target's dial queue + their Leads-tab section.
 */
export async function reassignLeads(
  leadIds: string[],
  toUserId: string,
): Promise<{ updated: number; error?: string }> {
  if (!isSupabaseConfigured())
    return { updated: 0, error: "Connect Supabase to manage leads." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { updated: 0, error: "You must be signed in." };
    const ids = [...new Set(leadIds.filter((id) => UUID.test(id)))];
    if (!ids.length) return { updated: 0, error: "No valid leads selected." };
    if (!UUID.test(toUserId))
      return { updated: 0, error: "Pick a teammate to reassign to." };

    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    if (!orgId || !isSupervisorRole(prof?.role) || !isAdminConfigured())
      return { updated: 0, error: "Only supervisors can reassign leads." };

    const admin = createAdminClient();
    // The target must be an active member of THIS org.
    const { data: member } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", toUserId)
      .eq("status", "active")
      .maybeSingle();
    if (!member)
      return { updated: 0, error: "That person isn't a member of your organization." };

    let updated = 0;
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { data, error } = await admin
        .from("leads")
        .update({ owner_id: toUserId, org_id: orgId })
        .in("id", batch)
        .eq("org_id", orgId) // never move leads outside the viewer's org
        .select("id");
      if (error) return { updated, error: error.message };
      updated += data?.length ?? 0;
    }
    return { updated };
  } catch (e) {
    return { updated: 0, error: e instanceof Error ? e.message : "Reassign failed." };
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
  // The power dialer is ALWAYS own-only — every person dials only the leads they
  // uploaded, so reps never dial each other's leads (supervisors included). The
  // Leads tab is where supervisors get the cross-account overview. Any lead with
  // a plausibly-dialable number (10+ digits) and a dialable status is included;
  // exact E.164 normalization happens at dial time.
  const dialable = (leads: Lead[]) =>
    leads
      .filter(
        (l) =>
          DIALABLE.includes(l.status) && l.phone.replace(/\D/g, "").length >= 10,
      )
      .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));

  if (!isSupabaseConfigured()) return dialable(fallbackLeads);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    // Page past the 1,000-row ceiling so the dialer queue holds EVERY dialable
    // lead — not just the first 1,000 (which silently dropped the rest).
    const data = await fetchAllRows<Row>((from, to) =>
      supabase
        .from("leads")
        .select("*")
        .eq("owner_id", user.id)
        .order("ai_score", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
    return dialable(data.map(rowToLead));
  } catch {
    return [];
  }
}

/**
 * Count the viewer's OWN leads (every status) — the denominator for the dialer's
 * "you have N leads but none are ready to dial" hint. Own-scoped to match the
 * own-only dial queue, so a supervisor's count isn't inflated by the whole org.
 */
export async function getMyLeadsCount(): Promise<number> {
  if (!isSupabaseConfigured()) return fallbackLeads.length;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 0;
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id);
    return count ?? 0;
  } catch {
    return 0;
  }
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

    // Batch inserts so large imports (thousands of rows) don't overflow Supabase's
    // request body limit. Same pattern as deleteLeads: small chunks, bounded waves.
    const CHUNK = 500;
    const WAVE = 4;
    const batches = [];
    for (let i = 0; i < payload.length; i += CHUNK) batches.push(payload.slice(i, i + CHUNK));

    let inserted = 0;
    for (let w = 0; w < batches.length; w += WAVE) {
      const wave = batches.slice(w, w + WAVE);
      const results = await Promise.all(
        wave.map((batch) => supabase.from("leads").insert(batch, { count: "exact" })),
      );
      for (const r of results) {
        if (r.error) return { inserted, invalidPhone, error: r.error.message };
        inserted += r.count ?? (r.data as unknown[] | null)?.length ?? 0;
      }
    }
    return { inserted, invalidPhone };
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
