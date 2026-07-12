import "server-only";

import { leads as fallbackLeads, getLeadById as fallbackById } from "../data";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { Lead, LeadStatus } from "../types";
import { normalizePhone } from "../utils";
import { canActOn, getScope } from "./scope";

// Account-scoped lead access. When Supabase is configured and the user is signed
// in, reads come from their `leads` table (RLS-enforced); otherwise it falls
// back to the in-memory source so demo mode keeps working.

const DIALABLE: LeadStatus[] = ["new", "no_answer", "callback"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// THE 1,000-ROW CEILING
//
// PostgREST caps every response at 1,000 rows by default. `.select("*")` with no
// `.range()` therefore returns AT MOST 1,000 rows — silently, with no error and
// nothing to indicate anything was withheld. This account has 17,342 leads, so
// the Leads tab showed 1,000 of them and the dial queue silently truncated to
// 1,000 even though 15,136 leads are dialable.
//
// Anything that must return "all" rows has to page explicitly.
// ─────────────────────────────────────────────────────────────────────────────

/** PostgREST's per-response ceiling. Pages are requested at exactly this size. */
const PAGE = 1000;
/** Hard stop so a runaway table can never OOM the server. */
const MAX_PAGED_ROWS = 100_000;

/**
 * Read EVERY row a query matches, paging past the 1,000-row cap.
 * `build()` must return a FRESH query builder each call (they aren't reusable).
 */
async function fetchAllPaged(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < MAX_PAGED_ROWS; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break; // short page ⇒ end of the table
  }
  return out;
}

export function rowToLead(r: Row): Lead {
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
    // Both branches PAGE — an un-ranged select silently stops at 1,000 rows, which
    // is why a 17,342-lead book rendered (and reported its total) as 1,000.
    if (!supervisor) {
      const rows = await fetchAllPaged(() =>
        supabase
          .from("leads")
          .select("*")
          .eq("owner_id", user.id)
          .order("ai_score", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true }),
      );
      return rows.map(rowToLead);
    }

    // Supervisor: the org pool + their own leads (covers any legacy null-org
    // rows), deduped, with each uploader's display name resolved for sections.
    const admin = createAdminClient();
    const [orgRows, ownRows, memberRes] = await Promise.all([
      fetchAllPaged(() =>
        admin
          .from("leads")
          .select("*")
          .eq("org_id", orgId as string)
          .order("id", { ascending: true }),
      ),
      fetchAllPaged(() =>
        admin
          .from("leads")
          .select("*")
          .eq("owner_id", user.id)
          .order("id", { ascending: true }),
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
      byId.set(String((r as Row).id), r as Row);
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

/**
 * Distribute leads EVENLY across a set of teammates (round-robin), so a batch
 * uploaded under one account can be split into each rep's own ownership in one
 * action. This is the fix for "everyone's dialing the same leads": once each
 * lead has a distinct owner_id, the own-only dial queue keeps reps off each
 * other's lists automatically. Supervisor-only, strictly org-scoped, and every
 * target is verified to be an active member of the caller's org.
 */
export async function distributeLeads(
  leadIds: string[],
  toUserIds: string[],
): Promise<{ updated: number; perUser: Record<string, number>; error?: string }> {
  if (!isSupabaseConfigured())
    return { updated: 0, perUser: {}, error: "Connect Supabase to manage leads." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { updated: 0, perUser: {}, error: "You must be signed in." };

    const ids = [...new Set(leadIds.filter((id) => UUID.test(id)))];
    if (!ids.length) return { updated: 0, perUser: {}, error: "No valid leads selected." };
    const targets = [...new Set(toUserIds.filter((id) => UUID.test(id)))];
    if (!targets.length) return { updated: 0, perUser: {}, error: "Pick at least one teammate." };

    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    if (!orgId || !isSupervisorRole(prof?.role) || !isAdminConfigured())
      return { updated: 0, perUser: {}, error: "Only supervisors can distribute leads." };

    const admin = createAdminClient();
    // Every target must be an active member of THIS org.
    const { data: members } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("status", "active")
      .in("user_id", targets);
    const valid = new Set(((members ?? []) as Row[]).map((m) => String(m.user_id)));
    const finalTargets = targets.filter((t) => valid.has(t));
    if (!finalTargets.length)
      return {
        updated: 0,
        perUser: {},
        error: "None of those teammates are members of your organization.",
      };

    // Round-robin: lead i → finalTargets[i % n]. Batched per owner like reassign.
    const buckets = new Map<string, string[]>();
    for (const t of finalTargets) buckets.set(t, []);
    ids.forEach((id, i) => buckets.get(finalTargets[i % finalTargets.length])!.push(id));

    let updated = 0;
    const perUser: Record<string, number> = {};
    for (const [uid, bucket] of buckets) {
      const CHUNK = 100;
      let cnt = 0;
      for (let i = 0; i < bucket.length; i += CHUNK) {
        const batch = bucket.slice(i, i + CHUNK);
        const { data, error } = await admin
          .from("leads")
          .update({ owner_id: uid, org_id: orgId })
          .in("id", batch)
          .eq("org_id", orgId) // never move another org's leads
          .select("id");
        if (error) return { updated, perUser, error: error.message };
        cnt += data?.length ?? 0;
      }
      perUser[uid] = cnt;
      updated += cnt;
    }
    return { updated, perUser };
  } catch (e) {
    return { updated: 0, perUser: {}, error: e instanceof Error ? e.message : "Distribute failed." };
  }
}

export interface LeadPatch {
  firstName?: string;
  lastName?: string;
  phone?: string;
  /** null clears the field. */
  email?: string | null;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  utilityProvider?: string;
  solarProvider?: string;
  /** "appointment" / "callback" are rejected here — those need routeDisposition()
   *  (via the disposition-override flow) so the appointments/callbacks table
   *  stays in sync with the lead's status. */
  status?: LeadStatus;
  /** null clears the field. */
  utilityBill?: number | null;
  /** null clears the field. */
  solarPayment?: number | null;
  hasEV?: boolean;
  hasPool?: boolean;
  hasBattery?: boolean;
  multipleSystems?: boolean;
  /** null clears the field. */
  notes?: string | null;
}

const LOCKED_STATUSES: LeadStatus[] = ["appointment", "callback"];

/**
 * Edit an existing lead's fields (contact info, address, energy details, status,
 * notes) — the general-purpose counterpart to the disposition flow, for
 * correcting data rather than filing a call outcome. Row-level scoped exactly
 * like every other lead write in this file (deleteLeads, reassignLeads): the
 * actor must own the lead, or be a supervisor acting within their own org.
 *
 * `status` deliberately excludes "appointment"/"callback" — those are backed by
 * rows in the appointments/callbacks tables (see routeDisposition() in
 * records.ts) that a plain status write here wouldn't create or clear, leaving
 * the lead's status and its pipeline tab disagreeing. Use the disposition
 * override flow (RowActions "Change disposition") for those transitions.
 */
export async function updateLead(
  id: string,
  patch: LeadPatch,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Connect Supabase to edit leads." };
  if (!UUID.test(id)) return { ok: false, error: "Invalid lead." };
  if (patch.status && LOCKED_STATUSES.includes(patch.status)) {
    return {
      ok: false,
      error:
        'Use "Change disposition" on the Appointments/Callbacks tab to move a lead to Appointment or Callback — it needs a scheduled time too.',
    };
  }
  try {
    const scope = await getScope();
    if (!scope) return { ok: false, error: "You must be signed in." };

    // Read who owns this lead first — canActOn() needs it to decide whether
    // THIS actor (owner, or a supervisor in the same org) may write to it.
    const reader = isAdminConfigured() ? createAdminClient() : await createClient();
    const { data: row } = await reader
      .from("leads")
      .select("owner_id, org_id")
      .eq("id", id)
      .maybeSingle();
    if (!row) return { ok: false, error: "Lead not found." };
    const r = row as Row;
    const rowOwnerId = r.owner_id ? String(r.owner_id) : null;
    const rowOrgId = r.org_id ? String(r.org_id) : null;
    if (!canActOn(scope, rowOwnerId, rowOrgId)) {
      return { ok: false, error: "You don't have permission to edit this lead." };
    }

    const fields: Record<string, unknown> = {};
    if (patch.firstName !== undefined) fields.first_name = patch.firstName;
    if (patch.lastName !== undefined) fields.last_name = patch.lastName;
    if (patch.phone !== undefined) {
      const normalized = normalizePhone(patch.phone);
      fields.phone = normalized || patch.phone;
    }
    if (patch.email !== undefined) fields.email = patch.email || null;
    if (patch.address !== undefined) fields.address = patch.address;
    if (patch.city !== undefined) fields.city = patch.city;
    if (patch.state !== undefined) fields.state = patch.state;
    if (patch.zip !== undefined) fields.zip = patch.zip;
    if (patch.utilityProvider !== undefined) fields.utility_provider = patch.utilityProvider;
    if (patch.solarProvider !== undefined) fields.solar_provider = patch.solarProvider;
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.utilityBill !== undefined) fields.utility_bill = patch.utilityBill;
    if (patch.solarPayment !== undefined) fields.solar_payment = patch.solarPayment;
    if (patch.hasEV !== undefined) fields.has_ev = patch.hasEV;
    if (patch.hasPool !== undefined) fields.has_pool = patch.hasPool;
    if (patch.hasBattery !== undefined) fields.has_battery = patch.hasBattery;
    if (patch.multipleSystems !== undefined) fields.multiple_systems = patch.multipleSystems;
    if (patch.notes !== undefined) fields.notes = patch.notes || null;

    if (Object.keys(fields).length === 0) return { ok: true };

    const writer = isAdminConfigured() ? createAdminClient() : await createClient();
    const { error } = await writer.from("leads").update(fields).eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
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
  // Scope matches the Leads tab (getLeads):
  //   • Rep         → own-only. Reps never dial a teammate's leads.
  //   • Supervisor  → the whole org's pool (owner/admin/manager). They see the
  //                   org's leads on the Leads tab, so they can dial them too —
  //                   otherwise an admin sees leads they physically can't call.
  // Any lead with a plausibly-dialable number (10+ digits) and a dialable status
  // is included; exact E.164 normalization happens at dial time.
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

    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const supervisor =
      Boolean(orgId) && isSupervisorRole(prof?.role) && isAdminConfigured();

    // PAGED. An un-ranged select stops at PostgREST's 1,000-row default without
    // any error, so this account's dial queue silently held 1,000 of its 15,136
    // dialable leads — 93% of the book invisible, and the dialer reporting "done"
    // having never touched it. Filter status in SQL too, so we page over dialable
    // rows rather than the whole 17k table.
    if (supervisor) {
      // Org-wide pool via the service-role client (RLS would hide other reps'
      // rows), scoped in code to this org — never another org's leads.
      const admin = createAdminClient();
      const rows = await fetchAllPaged(() =>
        admin
          .from("leads")
          .select("*")
          .eq("org_id", orgId as string)
          .in("status", DIALABLE)
          .order("ai_score", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true }),
      );
      return dialable(rows.map((r) => rowToLead(r as Row)));
    }

    const rows = await fetchAllPaged(() =>
      supabase
        .from("leads")
        .select("*")
        .eq("owner_id", user.id)
        .in("status", DIALABLE)
        .order("ai_score", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true }),
    );
    return dialable(rows.map((r) => rowToLead(r as Row)));
  } catch {
    return [];
  }
}

/**
 * Leads eligible for UNATTENDED auto-dialing across a whole org: dialable status,
 * a valid phone, and NOT contacted within `cooldownHours`. Ordered oldest-
 * contacted first (nulls first) so the scheduler works evenly through the list.
 * Admin-scoped (no user session) — used only by the cron auto-dialer.
 */
export async function getAutoDialLeadsForOrg(
  orgId: string,
  opts: { cooldownHours: number; limit: number },
): Promise<Lead[]> {
  if (!orgId || !isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const cutoff = new Date(
      Date.now() - Math.max(0, opts.cooldownHours) * 3_600_000,
    ).toISOString();
    const { data, error } = await admin
      .from("leads")
      .select("*")
      .eq("org_id", orgId)
      .in("status", DIALABLE)
      // Never dialed, or last dialed before the cooldown cutoff.
      .or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`)
      .order("last_contacted_at", { ascending: true, nullsFirst: true })
      .limit(Math.max(1, opts.limit));
    if (error) return [];
    return (data ?? [])
      .map((r) => rowToLead(r as Row))
      .filter((l) => l.phone.replace(/\D/g, "").length >= 10);
  } catch {
    return [];
  }
}

/** Stamp a lead as just-contacted so the auto-dialer won't immediately re-pick it. */
export async function touchLeadContacted(
  orgId: string,
  leadId: string,
  iso: string,
): Promise<void> {
  if (!orgId || !UUID.test(leadId) || !isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    await admin
      .from("leads")
      .update({ last_contacted_at: iso })
      .eq("id", leadId)
      .eq("org_id", orgId);
  } catch {
    /* best-effort */
  }
}

/**
 * Count the leads in the viewer's dial scope (every status) — the denominator
 * for the dialer's "you have N leads but none are ready to dial" hint. Matches
 * getDialQueue's scope: a supervisor's org-wide pool, a rep's own leads.
 */
export async function getMyLeadsCount(): Promise<number> {
  if (!isSupabaseConfigured()) return fallbackLeads.length;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 0;
    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const supervisor =
      Boolean(orgId) && isSupervisorRole(prof?.role) && isAdminConfigured();
    if (supervisor) {
      const { count } = await createAdminClient()
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId as string);
      return count ?? 0;
    }
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
