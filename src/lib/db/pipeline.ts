import "server-only";

import { reconcileOwnerActiveCalls } from "../ai-call-reconcile";
import { statsForCampaign, type CampaignStats } from "../campaign-stats";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import { canActOn, getScope } from "./scope";

// Account-scoped reads/writes for the pipeline surfaces. Each returns empty (or
// a graceful error) in demo mode instead of throwing. Appointments + callbacks
// are org-aware: supervisors see the whole org, reps see their own.

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

/**
 * Appointment times are stored as the agreed wall-clock (the resolver anchors
 * them to the homeowner's timezone). Postgres returns timestamptz with a `+00`
 * offset, which would re-shift the time in the viewer's locale — so strip the
 * offset and hand the client a naive local string it renders as-is everywhere
 * (calendar, buckets, labels).
 */
const toFloatingLocal = (v: string): string => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/.exec(v);
  return m ? `${m[1]}T${m[2]}` : v;
};

/** owner_id → display name for an org (to attribute team rows). */
async function memberNames(orgId: string): Promise<Map<string, string>> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("organization_members")
      .select("user_id,name")
      .eq("org_id", orgId)
      .eq("status", "active");
    return new Map(((data ?? []) as Row[]).map((m) => [s(m.user_id), s(m.name)]));
  } catch {
    return new Map();
  }
}

// ── Campaigns (org-shared) ───────────────────────────────────────────────────
export interface CampaignRow {
  id: string;
  name: string;
  utilityProvider: string;
  status: "active" | "paused" | "completed";
  color: string;
  createdAt: string;
  ownerId: string | null;
  stats: CampaignStats;
}

type Result = { ok: boolean; error?: string };

/**
 * Campaigns are shared across the org: every member sees them and their live
 * stats (leads + call performance keyed by campaign_id). Reads go org-wide via
 * the service-role client when available; otherwise own-scoped.
 */
export async function getCampaigns(): Promise<CampaignRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const scope = await getScope();
    if (!scope) return [];
    const useOrg = isAdminConfigured() && Boolean(scope.orgId);
    const reader = useOrg ? createAdminClient() : await createClient();
    const col = useOrg ? "org_id" : "owner_id";
    const val = useOrg ? (scope.orgId as string) : scope.userId;
    const [cRes, lRes, callRes] = await Promise.all([
      reader.from("campaigns").select("*").eq(col, val).order("created_at", { ascending: false }),
      reader.from("leads").select("campaign_id,status").eq(col, val),
      reader.from("call_records").select("campaign_id,outcome").eq(col, val),
    ]);
    const leads = (lRes.data ?? []) as Row[];
    const calls = (callRes.data ?? []) as Row[];
    return ((cRes.data ?? []) as Row[]).map((r) => ({
      id: s(r.id),
      name: s(r.name),
      utilityProvider: s(r.utility_provider),
      status: (s(r.status) || "active") as CampaignRow["status"],
      color: s(r.color) || "#3B82F6",
      createdAt: s(r.created_at),
      ownerId: r.owner_id ? s(r.owner_id) : null,
      stats: statsForCampaign(s(r.id), leads, calls),
    }));
  } catch {
    return [];
  }
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const all = await getCampaigns();
  return all.find((c) => c.id === id) ?? null;
}

export async function createCampaign(input: {
  name: string;
  utilityProvider?: string;
  color?: string;
}): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Connect Supabase to create campaigns." };
  if (!isAdminConfigured()) return { ok: false, error: "Service role required to create campaigns." };
  try {
    const scope = await getScope();
    if (!scope) return { ok: false, error: "You must be signed in." };
    const { error } = await createAdminClient().from("campaigns").insert({
      owner_id: scope.userId,
      org_id: scope.orgId,
      name: input.name,
      utility_provider: input.utilityProvider ?? "",
      color: input.color ?? "#3B82F6",
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Load a campaign for a write + confirm the actor may touch it. */
async function authorizeCampaign(
  id: string,
): Promise<{ admin: ReturnType<typeof createAdminClient> } | { error: string }> {
  if (!isAdminConfigured()) return { error: "Service role not configured." };
  const scope = await getScope();
  if (!scope) return { error: "You must be signed in." };
  const admin = createAdminClient();
  const { data } = await admin
    .from("campaigns")
    .select("owner_id, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { error: "Campaign not found." };
  if (!canActOn(scope, data.owner_id as string, (data.org_id as string) ?? null))
    return { error: "You don't have access to this campaign." };
  return { admin };
}

export async function setCampaignStatus(
  id: string,
  status: "active" | "paused" | "completed",
): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Not configured." };
  const auth = await authorizeCampaign(id);
  if ("error" in auth) return { ok: false, error: auth.error };
  const { error } = await auth.admin.from("campaigns").update({ status }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteCampaign(id: string): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Not configured." };
  const auth = await authorizeCampaign(id);
  if ("error" in auth) return { ok: false, error: auth.error };
  // Unassign the campaign's leads first so none point at a deleted campaign.
  await auth.admin.from("leads").update({ campaign_id: null }).eq("campaign_id", id);
  const { error } = await auth.admin.from("campaigns").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Assign (or clear, with null) a set of leads to a campaign — scoped to the actor. */
export async function assignLeadsToCampaign(
  leadIds: string[],
  campaignId: string | null,
): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Not configured." };
  if (!isAdminConfigured()) return { ok: false, error: "Service role not configured." };
  const scope = await getScope();
  if (!scope) return { ok: false, error: "You must be signed in." };
  const ids = leadIds.filter(Boolean).slice(0, 5000);
  if (!ids.length) return { ok: false, error: "No leads selected." };
  const admin = createAdminClient();
  if (campaignId) {
    const { data: camp } = await admin
      .from("campaigns")
      .select("owner_id, org_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (!camp) return { ok: false, error: "Campaign not found." };
    if (!canActOn(scope, camp.owner_id as string, (camp.org_id as string) ?? null))
      return { ok: false, error: "You don't have access to that campaign." };
  }
  // Scope the update so reps only touch their own leads, supervisors their org's.
  const base = admin.from("leads").update({ campaign_id: campaignId }).in("id", ids);
  const q =
    scope.supervisor && scope.orgId
      ? base.eq("org_id", scope.orgId)
      : base.eq("owner_id", scope.userId);
  const { error } = await q;
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Appointments ─────────────────────────────────────────────────────────────
export interface AppointmentRow {
  id: string;
  leadId: string | null;
  leadName: string;
  status: string;
  source: string;
  /** AI bookings are proposals (false) until a human approves them. */
  approved: boolean;
  scheduledLabel: string;
  scheduledAt: string | null;
  notes: string;
  phone: string;
  city: string;
  createdAt: string;
  reviewedAt: string | null;
  /** Owning rep's name (team view only). */
  repName?: string;
  /** Whether the viewer sees the whole org's pipeline. */
  teamWide: boolean;
}

export async function getAppointments(): Promise<AppointmentRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const scope = await getScope();
    if (!scope) return [];
    // Finalize any stuck calls first so freshly-booked reviews show immediately.
    await reconcileOwnerActiveCalls();
    const orgWide = scope.supervisor && isAdminConfigured() && Boolean(scope.orgId);
    const reader = orgWide ? createAdminClient() : await createClient();
    const { data } = await reader
      .from("appointments")
      .select("*")
      .eq(orgWide ? "org_id" : "owner_id", orgWide ? scope.orgId : scope.userId)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Row[];
    const names = orgWide ? await memberNames(scope.orgId as string) : null;

    // Batch the leads' phone/city for richer review context.
    const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean).map(String))];
    const contacts = new Map<string, { phone: string; city: string }>();
    if (leadIds.length) {
      const { data: ls } = await reader.from("leads").select("id,phone,city").in("id", leadIds);
      for (const l of (ls ?? []) as Row[])
        contacts.set(s(l.id), { phone: s(l.phone), city: s(l.city) });
    }

    return rows.map((r) => {
      const c = r.lead_id ? contacts.get(s(r.lead_id)) : undefined;
      return {
        id: s(r.id),
        leadId: r.lead_id ? s(r.lead_id) : null,
        leadName: s(r.lead_name) || "Homeowner",
        status: s(r.status) || "scheduled",
        source: s(r.source) || "ai",
        // Treat legacy rows (column absent → null) as approved, not pending.
        approved: r.approved == null ? true : Boolean(r.approved),
        scheduledLabel: s(r.scheduled_label),
        scheduledAt: r.scheduled_at ? toFloatingLocal(s(r.scheduled_at)) : null,
        notes: s(r.notes),
        phone: c?.phone ?? "",
        city: c?.city ?? "",
        createdAt: s(r.created_at),
        reviewedAt: r.reviewed_at ? s(r.reviewed_at) : null,
        repName: names ? names.get(s(r.owner_id)) || "Rep" : undefined,
        teamWide: orgWide,
      };
    });
  } catch {
    return [];
  }
}

// ── Bills are fine ───────────────────────────────────────────────────────────
export interface BillsFineRow {
  id: string;
  leadName: string;
  phone: string;
  address: string;
  utilityBill: number | null;
  solarPayment: number | null;
  utilityProvider: string;
  lastContactedAt: string | null;
  createdAt: string;
  repName?: string;
  teamWide: boolean;
}

export async function getBillsFine(): Promise<BillsFineRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const scope = await getScope();
    if (!scope) return [];
    const orgWide = scope.supervisor && isAdminConfigured() && Boolean(scope.orgId);
    const reader = orgWide ? createAdminClient() : await createClient();
    const { data } = await reader
      .from("leads")
      .select("id,first_name,last_name,phone,address,utility_bill,solar_payment,utility_provider,last_contacted_at,created_at,owner_id")
      .eq(orgWide ? "org_id" : "owner_id", orgWide ? scope.orgId : scope.userId)
      .eq("status", "bills_fine")
      .order("last_contacted_at", { ascending: false });
    const names = orgWide ? await memberNames(scope.orgId as string) : null;
    return ((data ?? []) as Row[]).map((r) => ({
      id: s(r.id),
      leadName: `${s(r.first_name)} ${s(r.last_name)}`.trim() || "Homeowner",
      phone: s(r.phone),
      address: s(r.address),
      utilityBill: r.utility_bill == null ? null : Number(r.utility_bill),
      solarPayment: r.solar_payment == null ? null : Number(r.solar_payment),
      utilityProvider: s(r.utility_provider),
      lastContactedAt: r.last_contacted_at ? s(r.last_contacted_at) : null,
      createdAt: s(r.created_at),
      repName: names ? names.get(s(r.owner_id)) || "Rep" : undefined,
      teamWide: orgWide,
    }));
  } catch {
    return [];
  }
}

// ── Callbacks ────────────────────────────────────────────────────────────────
export interface CallbackRow {
  id: string;
  leadId: string | null;
  leadName: string;
  phone: string;
  reason: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  repName?: string;
  teamWide: boolean;
}

export async function getCallbacks(): Promise<CallbackRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const scope = await getScope();
    if (!scope) return [];
    // Finalize any stuck calls first so callback-dispositioned ones show up.
    await reconcileOwnerActiveCalls();
    const orgWide = scope.supervisor && isAdminConfigured() && Boolean(scope.orgId);
    const reader = orgWide ? createAdminClient() : await createClient();
    const { data } = await reader
      .from("callbacks")
      .select("*")
      .eq(orgWide ? "org_id" : "owner_id", orgWide ? scope.orgId : scope.userId)
      .order("created_at", { ascending: false });
    const names = orgWide ? await memberNames(scope.orgId as string) : null;
    return (data ?? []).map((r: Row) => ({
      id: s(r.id),
      leadId: r.lead_id ? s(r.lead_id) : null,
      leadName: s(r.lead_name) || "Homeowner",
      phone: s(r.phone),
      reason: s(r.reason),
      status: s(r.status) || "due",
      dueAt: r.due_at ? s(r.due_at) : null,
      createdAt: s(r.created_at),
      repName: names ? names.get(s(r.owner_id)) || "Rep" : undefined,
      teamWide: orgWide,
    }));
  } catch {
    return [];
  }
}
