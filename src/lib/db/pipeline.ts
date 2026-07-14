import "server-only";

import { reconcileOwnerActiveCalls } from "../ai-call-reconcile";
import { statsForCampaign, type CampaignStats } from "../campaign-stats";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import { formatAddress } from "../utils";
import { apptScope } from "./appointments";
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
      reader
        .from("campaigns")
        .select("*")
        .eq(col, val)
        .order("created_at", { ascending: false })
        .limit(useOrg ? 2000 : 500),
      reader.from("leads").select("campaign_id,status").eq(col, val).limit(useOrg ? 50000 : 5000),
      reader
        .from("call_records")
        .select("campaign_id,outcome")
        .eq(col, val)
        .limit(useOrg ? 20000 : 2000),
    ]);
    if (cRes.error) console.error("[pipeline] getCampaigns campaigns query failed:", cRes.error.message);
    if (lRes.error) console.error("[pipeline] getCampaigns leads query failed:", lRes.error.message);
    if (callRes.error) console.error("[pipeline] getCampaigns call_records query failed:", callRes.error.message);
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
  } catch (e) {
    console.error("[pipeline] getCampaigns failed:", e instanceof Error ? e.message : e);
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
  // Scope the update so reps only touch their own leads within their CURRENT
  // org (never a past org's leads they still happen to own), supervisors their
  // org's whole pool.
  const base = admin.from("leads").update({ campaign_id: campaignId }).in("id", ids);
  let q =
    scope.supervisor && scope.orgId ? base.eq("org_id", scope.orgId) : base.eq("owner_id", scope.userId);
  if (!scope.supervisor && scope.orgId) q = q.eq("org_id", scope.orgId);
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
  /**
   * Floating wall clock ("2026-07-14T18:00:00") or null when the booking has no
   * pinned time yet. See src/lib/appointments/time.ts for the invariant.
   */
  scheduledAt: string | null;
  durationMin: number;
  location: string;
  timezone: string;
  title: string;
  notes: string;
  phone: string;
  city: string;
  address: string;
  createdAt: string;
  reviewedAt: string | null;
  cancelReason: string;
  rescheduleCount: number;
  /** The call this appointment came out of, if any. */
  callRecordId: string | null;
  /** Who runs the review (defaults to the booker). Drives the per-rep calendar. */
  assignedTo: string | null;
  assignedToName: string;
  ownerId: string;
  /** Owning rep's name (team view only). */
  repName?: string;
  /** Whether the viewer sees the whole org's calendar. */
  teamWide: boolean;
  /** Delivery state of the "appointment set" email: null when nothing was queued. */
  notifyStatus: "pending" | "sent" | "failed" | "skipped" | null;
}

export async function getAppointments(): Promise<AppointmentRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const scope = await apptScope();
    if (!scope) return [];
    // Finalize any stuck calls first so freshly-booked reviews show immediately.
    await reconcileOwnerActiveCalls();
    // Org-wide is the `appointments.team` permission now, not the role. The role
    // defaults grant it to owner/admin/manager, so this is the same set as the old
    // `scope.supervisor` check — but an override finally means something.
    const orgWide = scope.team && isAdminConfigured() && Boolean(scope.orgId);
    const reader = orgWide ? createAdminClient() : await createClient();
    let query = reader
      .from("appointments")
      .select("*")
      .eq(orgWide ? "org_id" : "owner_id", orgWide ? scope.orgId : scope.userId);
    // A rep's "own" scope must stay within their CURRENT org — never surface
    // appointments they happen to own from an org they've since left.
    if (!orgWide && scope.orgId) query = query.eq("org_id", scope.orgId);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(orgWide ? 5000 : 500);
    if (error) console.error("[pipeline] getAppointments query failed:", error.message);
    const rows = (data ?? []) as Row[];
    const names = orgWide ? await memberNames(scope.orgId as string) : null;

    // Batch the leads' contact details for the review lane + the email context.
    const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean).map(String))];
    const contacts = new Map<string, { phone: string; city: string; address: string }>();
    if (leadIds.length) {
      const { data: ls } = await reader
        .from("leads")
        .select("id,phone,city,address,state,zip")
        .in("id", leadIds);
      for (const l of (ls ?? []) as Row[])
        contacts.set(s(l.id), {
          phone: s(l.phone),
          city: s(l.city),
          address: formatAddress({
            address: s(l.address),
            city: s(l.city),
            state: s(l.state),
            zip: s(l.zip),
          }),
        });
    }

    // Delivery state of each appointment's notification, so a failed send is
    // visible ON the thing it failed for — not just buried in a log.
    const notify = await latestNotifyStatus(rows.map((r) => s(r.id)));

    return rows.map((r) => {
      const c = r.lead_id ? contacts.get(s(r.lead_id)) : undefined;
      const assignedTo = r.assigned_to ? s(r.assigned_to) : s(r.owner_id) || null;
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
        durationMin: Number(r.duration_min ?? 60) || 60,
        location: s(r.location),
        timezone: s(r.timezone),
        title: s(r.title),
        notes: s(r.notes),
        phone: c?.phone ?? "",
        city: c?.city ?? "",
        address: c?.address ?? "",
        createdAt: s(r.created_at),
        reviewedAt: r.reviewed_at ? s(r.reviewed_at) : null,
        cancelReason: s(r.cancel_reason),
        rescheduleCount: Number(r.reschedule_count ?? 0) || 0,
        callRecordId: r.call_record_id ? s(r.call_record_id) : null,
        assignedTo,
        assignedToName: names && assignedTo ? names.get(assignedTo) || "Rep" : "",
        ownerId: s(r.owner_id),
        repName: names ? names.get(s(r.owner_id)) || "Rep" : undefined,
        teamWide: orgWide,
        notifyStatus: notify.get(s(r.id)) ?? null,
      };
    });
  } catch (e) {
    console.error("[pipeline] getAppointments failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** appointment_id → the delivery state of its most recent notification. */
async function latestNotifyStatus(
  ids: string[],
): Promise<Map<string, "pending" | "sent" | "failed" | "skipped">> {
  const out = new Map<string, "pending" | "sent" | "failed" | "skipped">();
  if (!ids.length || !isAdminConfigured()) return out;
  try {
    const { data } = await createAdminClient()
      .from("notification_outbox")
      .select("appointment_id,status,created_at")
      .in("appointment_id", ids.slice(0, 1000))
      .order("created_at", { ascending: true });
    // Ascending, so the last write per appointment wins — the newest state.
    for (const r of (data ?? []) as Row[]) {
      const id = s(r.appointment_id);
      if (id) out.set(id, s(r.status) as "pending" | "sent" | "failed" | "skipped");
    }
  } catch {
    /* the calendar renders fine without delivery badges */
  }
  return out;
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
    let query = reader
      .from("leads")
      .select("id,first_name,last_name,phone,address,utility_bill,solar_payment,utility_provider,last_contacted_at,created_at,owner_id")
      .eq(orgWide ? "org_id" : "owner_id", orgWide ? scope.orgId : scope.userId)
      .eq("status", "bills_fine");
    // A rep's "own" scope must stay within their CURRENT org — never surface
    // leads they happen to own from an org they've since left.
    if (!orgWide && scope.orgId) query = query.eq("org_id", scope.orgId);
    const { data, error } = await query
      .order("last_contacted_at", { ascending: false })
      .limit(orgWide ? 50000 : 5000);
    if (error) console.error("[pipeline] getBillsFine query failed:", error.message);
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
  } catch (e) {
    console.error("[pipeline] getBillsFine failed:", e instanceof Error ? e.message : e);
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
    let query = reader
      .from("callbacks")
      .select("*")
      .eq(orgWide ? "org_id" : "owner_id", orgWide ? scope.orgId : scope.userId);
    // A rep's "own" scope must stay within their CURRENT org — never surface
    // callbacks they happen to own from an org they've since left.
    if (!orgWide && scope.orgId) query = query.eq("org_id", scope.orgId);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(orgWide ? 5000 : 500);
    if (error) console.error("[pipeline] getCallbacks query failed:", error.message);
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
  } catch (e) {
    console.error("[pipeline] getCallbacks failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
