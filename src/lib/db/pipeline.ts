import "server-only";

import { reconcileOwnerActiveCalls } from "../ai-call-reconcile";
import {
  emptyFunnel,
  filterCallerIds,
  filterDispositionKeys,
  parseFunnel,
  sanitizeAudience,
  sanitizeDialingPolicy,
  sanitizeGoals,
  sanitizeRetryPolicy,
  type CampaignAudience,
  type CampaignDialingPolicy,
  type CampaignFunnel,
  type CampaignGoals,
  type CampaignRetryPolicy,
} from "../campaign-policy";
import {
  scriptTestForCampaign,
  statsForCampaign,
  type CampaignStats,
  type ScriptTestStats,
} from "../campaign-stats";
import { resolveDispositionDefs } from "../dispositions/defs";
import { mergeSettings } from "../org/settings";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { CallOutcome, CampaignStatus } from "../types";
import { formatAddress } from "../utils";
import { apptScope } from "./appointments";
import { canActOn, getScope } from "./scope";
import { askedCount } from "./counts";

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

// ─────────────────────────────────────────────────────────────────────────────
// PostgREST silently caps every un-ranged response at 1,000 rows — a plain
// `.limit(5000)` therefore returns AT MOST 1,000, with no error. (Full story in
// src/lib/db/leads.ts, "THE 1,000-ROW CEILING".) Anything here that promises
// more than 1,000 rows must page explicitly with `.range()`.
// ─────────────────────────────────────────────────────────────────────────────

/** PostgREST's per-response ceiling. Pages are requested at exactly this size. */
const PAGE = 1000;

/**
 * Read up to `max` rows, paging past the 1,000-row cap in `.range()` windows.
 * `build()` must return a FRESH query builder each call (they aren't reusable).
 */
async function fetchPagedUpTo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any,
  max: number,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const size = Math.min(PAGE, max - from);
    const { data, error } = await build().range(from, from + size - 1);
    if (error) {
      console.error("[pipeline] paged read failed:", error.message);
      break;
    }
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < size) break; // short page ⇒ end of the result set
  }
  return out;
}

/**
 * User-typed search text gets interpolated into PostgREST `.or()`/`.ilike`
 * filter strings, where commas and parens are FILTER SYNTAX and `%`/`_` are
 * LIKE wildcards. Strip anything that could break out of (or wildcard) the
 * pattern rather than trying to escape it — names and phone fragments never
 * legitimately contain these characters.
 */
function sanitizeFilterTerm(raw: string): string {
  return raw
    .replace(/[,()%_\\]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

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
  status: CampaignStatus;
  color: string;
  createdAt: string;
  ownerId: string | null;
  /** Call script shown to reps in the dialer ("" = none). */
  scriptA: string;
  /** Second script — when BOTH are set, an A/B test splits leads between them. */
  scriptB: string;
  // Operational fields (schema PART 34) — sanitized on read, because the jsonb
  // columns hold whatever the last writer stored (see src/lib/campaign-policy.ts).
  description: string;
  objective: string;
  /** Set = the campaign is archived (hidden from active flows, kept for history). */
  archivedAt: string | null;
  audience: CampaignAudience | null;
  dialingPolicy: CampaignDialingPolicy | null;
  /** Subset of the org's caller-ID pool this campaign dials from. Empty = pool. */
  callerIds: string[];
  retryPolicy: CampaignRetryPolicy | null;
  /** Disposition keys the wrap-up panel offers on this campaign. Empty = all. */
  dispositionKeys: string[];
  goals: CampaignGoals | null;
  stats: CampaignStats;
  /** Per-variant performance over calls where a script was actually shown. */
  scriptTest: ScriptTestStats;
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
    // The stats inputs MUST page: a bare .limit() above 1,000 is a no-op
    // (PostgREST silently caps every un-ranged response at 1,000 rows — see
    // the header comment), so campaign lead counts, connect rates, and the
    // script A/B split were computed over an arbitrary 1,000-row sample of
    // any real book. Ordered so pages are stable while paging.
    const [cRes, leads, calls] = await Promise.all([
      reader
        .from("campaigns")
        .select("*")
        .eq(col, val)
        .order("created_at", { ascending: false })
        .limit(useOrg ? 2000 : 500),
      fetchPagedUpTo(
        () =>
          reader
            .from("leads")
            .select("campaign_id,status")
            .eq(col, val)
            .order("id", { ascending: true }),
        useOrg ? 50000 : 5000,
      ),
      fetchPagedUpTo(
        () =>
          reader
            .from("call_records")
            .select("campaign_id,outcome,script_variant")
            .eq(col, val)
            .order("id", { ascending: true }),
        useOrg ? 20000 : 2000,
      ),
    ]);
    if (cRes.error) console.error("[pipeline] getCampaigns campaigns query failed:", cRes.error.message);
    return ((cRes.data ?? []) as Row[]).map((r) => ({
      id: s(r.id),
      name: s(r.name),
      utilityProvider: s(r.utility_provider),
      status: (s(r.status) || "active") as CampaignRow["status"],
      color: s(r.color) || "#3B82F6",
      createdAt: s(r.created_at),
      ownerId: r.owner_id ? s(r.owner_id) : null,
      scriptA: s(r.script_a),
      scriptB: s(r.script_b),
      description: s(r.description),
      objective: s(r.objective),
      archivedAt: r.archived_at ? s(r.archived_at) : null,
      audience: sanitizeAudience(r.audience),
      dialingPolicy: sanitizeDialingPolicy(r.dialing_policy),
      callerIds: Array.isArray(r.caller_ids)
        ? (r.caller_ids as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
      retryPolicy: sanitizeRetryPolicy(r.retry_policy),
      dispositionKeys: Array.isArray(r.disposition_keys)
        ? (r.disposition_keys as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
      goals: sanitizeGoals(r.goals),
      stats: statsForCampaign(s(r.id), leads, calls),
      scriptTest: scriptTestForCampaign(s(r.id), calls),
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
  scriptA?: string;
  scriptB?: string;
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
      script_a: (input.scriptA ?? "").trim(),
      script_b: (input.scriptB ?? "").trim(),
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Load a campaign for a write + confirm the actor may touch it. */
async function authorizeCampaign(id: string): Promise<
  | {
      admin: ReturnType<typeof createAdminClient>;
      /** The campaign's org (null for pre-org rows) — validation reads its settings. */
      orgId: string | null;
      /** The authenticated actor (audit rows, clone ownership). */
      userId: string;
    }
  | { error: string }
> {
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
  return { admin, orgId: (data.org_id as string) ?? null, userId: scope.userId };
}

/**
 * The org's merged settings, for validating campaign policy writes against what
 * the workspace actually has (caller-ID pool, resolved disposition keys). A
 * failed read returns the defaults — which validate to the EMPTY pool, so a
 * transient error can never let a foreign caller ID slip into storage.
 */
async function orgSettingsFor(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string | null,
) {
  if (!orgId) return mergeSettings(null);
  try {
    const { data } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();
    return mergeSettings(data?.settings ?? null);
  } catch {
    return mergeSettings(null);
  }
}

export async function setCampaignStatus(
  id: string,
  status: CampaignStatus,
): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Not configured." };
  const auth = await authorizeCampaign(id);
  if ("error" in auth) return { ok: false, error: auth.error };
  const { error } = await auth.admin.from("campaigns").update({ status }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Runtime guard for statuses arriving over the API as arbitrary strings. */
const CAMPAIGN_STATUSES: ReadonlySet<string> = new Set<CampaignStatus>([
  "active",
  "paused",
  "completed",
]);

/** The sparse-edit surface PATCH /api/campaigns forwards (see updateCampaign). */
export interface CampaignPatch {
  name?: string;
  utilityProvider?: string;
  color?: string;
  status?: CampaignStatus;
  /** Trimmed on write; an empty string CLEARS the script (columns default ''). */
  scriptA?: string;
  scriptB?: string;
  description?: string;
  objective?: string;
  /** true stamps archived_at (now), false clears it. */
  archived?: boolean;
  /** Sanitized on write; null clears back to "no audience configured". */
  audience?: unknown;
  dialingPolicy?: unknown;
  /** Filtered to the org's own pool — foreign numbers are dropped, not stored. */
  callerIds?: unknown;
  retryPolicy?: unknown;
  /** Filtered to the org's resolved disposition keys. Empty = all. */
  dispositionKeys?: unknown;
  goals?: unknown;
}

/**
 * Sparse edit of a campaign's own fields — identity, scripts, and the PART 34
 * policy columns. Only the provided keys change; same authorization as
 * setCampaignStatus (any member the campaign's owner/org scope admits). The
 * jsonb payloads are UNTRUSTED request-body values and go through the
 * campaign-policy sanitizers here, so storage only ever holds valid shapes —
 * and caller IDs / disposition keys are validated against the ORG's own pool
 * and resolved disposition set, never taken at the client's word.
 */
export async function updateCampaign(id: string, patch: CampaignPatch): Promise<Result> {
  if (!isSupabaseConfigured())
    return { ok: false, error: "Connect Supabase to edit campaigns." };
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, error: "Name is required." };
    update.name = name;
  }
  if (patch.utilityProvider !== undefined) update.utility_provider = patch.utilityProvider.trim();
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.scriptA !== undefined) update.script_a = patch.scriptA.trim();
  if (patch.scriptB !== undefined) update.script_b = patch.scriptB.trim();
  if (patch.description !== undefined) update.description = patch.description.trim().slice(0, 2000);
  if (patch.objective !== undefined) update.objective = patch.objective.trim().slice(0, 500);
  if (patch.archived !== undefined)
    update.archived_at = patch.archived ? new Date().toISOString() : null;
  if (patch.audience !== undefined)
    update.audience = patch.audience === null ? null : sanitizeAudience(patch.audience);
  if (patch.dialingPolicy !== undefined)
    update.dialing_policy =
      patch.dialingPolicy === null ? null : sanitizeDialingPolicy(patch.dialingPolicy);
  if (patch.retryPolicy !== undefined)
    update.retry_policy =
      patch.retryPolicy === null ? null : sanitizeRetryPolicy(patch.retryPolicy);
  if (patch.goals !== undefined)
    update.goals = patch.goals === null ? null : sanitizeGoals(patch.goals);
  if (patch.status !== undefined) {
    if (!CAMPAIGN_STATUSES.has(patch.status))
      return { ok: false, error: "Status must be active, paused, or completed." };
    update.status = patch.status;
  }
  const needsSettings = patch.callerIds !== undefined || patch.dispositionKeys !== undefined;
  if (Object.keys(update).length === 0 && !needsSettings)
    return { ok: false, error: "Nothing to update." };
  const auth = await authorizeCampaign(id);
  if ("error" in auth) return { ok: false, error: auth.error };
  if (needsSettings) {
    const settings = await orgSettingsFor(auth.admin, auth.orgId);
    if (patch.callerIds !== undefined)
      update.caller_ids = filterCallerIds(patch.callerIds, settings.dialing.callerIds);
    if (patch.dispositionKeys !== undefined)
      update.disposition_keys = filterDispositionKeys(
        patch.dispositionKeys,
        resolveDispositionDefs(settings.dispositions).map((d) => d.key),
      );
  }
  const { error } = await auth.admin.from("campaigns").update(update).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Duplicate a campaign's SETUP — identity, scripts, and every policy column —
 * as a fresh row named "<name> (copy)". Stats are keyed by campaign_id, so the
 * clone naturally starts at zero; it also starts PAUSED so duplicating an
 * active play can't instantly double-dial the same audience. The clone is
 * recorded in assignment_events (action 'campaign_cloned', pack_id null) so
 * the audit trail explains where a near-identical campaign came from.
 */
export async function cloneCampaign(id: string): Promise<Result & { id?: string }> {
  if (!isSupabaseConfigured())
    return { ok: false, error: "Connect Supabase to clone campaigns." };
  const auth = await authorizeCampaign(id);
  if ("error" in auth) return { ok: false, error: auth.error };
  try {
    const { data: src, error: readErr } = await auth.admin
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (readErr || !src) return { ok: false, error: "Campaign not found." };
    const r = src as Row;
    const { data: created, error } = await auth.admin
      .from("campaigns")
      .insert({
        owner_id: auth.userId,
        org_id: r.org_id ?? null,
        name: `${s(r.name) || "Campaign"} (copy)`.slice(0, 200),
        utility_provider: s(r.utility_provider),
        status: "paused",
        color: s(r.color) || "#3B82F6",
        script_a: s(r.script_a),
        script_b: s(r.script_b),
        description: s(r.description),
        objective: s(r.objective),
        audience: r.audience ?? null,
        dialing_policy: r.dialing_policy ?? null,
        caller_ids: Array.isArray(r.caller_ids) ? r.caller_ids : [],
        retry_policy: r.retry_policy ?? null,
        disposition_keys: Array.isArray(r.disposition_keys) ? r.disposition_keys : [],
        goals: r.goals ?? null,
      })
      .select("id")
      .maybeSingle();
    if (error || !created) return { ok: false, error: error?.message ?? "Clone failed." };
    const newId = s((created as Row).id);
    if (auth.orgId) {
      // Best-effort audit row — a failed insert must not undo a good clone.
      await auth.admin.from("assignment_events").insert({
        org_id: auth.orgId,
        pack_id: null,
        actor_id: auth.userId,
        action: "campaign_cloned",
        payload: { sourceId: id, newId },
      });
    }
    return { ok: true, id: newId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Clone failed." };
  }
}

/**
 * The accurate, mutually-exclusive funnel for one campaign — a single RPC scan
 * (app_campaign_funnel, schema PART 34) so the buckets can never double-count.
 * Demo / degraded mode reads as all-zero rather than crashing the page.
 */
export async function getCampaignFunnel(
  orgId: string | null,
  campaignId: string,
): Promise<CampaignFunnel> {
  if (!isAdminConfigured() || !orgId) return emptyFunnel();
  try {
    const { data, error } = await createAdminClient().rpc("app_campaign_funnel", {
      p_org: orgId,
      p_campaign: campaignId,
    });
    if (error) {
      console.error("[pipeline] getCampaignFunnel failed:", error.message);
      return emptyFunnel();
    }
    return parseFunnel(data);
  } catch (e) {
    console.error("[pipeline] getCampaignFunnel failed:", e instanceof Error ? e.message : e);
    return emptyFunnel();
  }
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

/** One row of a campaign's recent call activity (the detail page's feed). */
export interface CampaignCallRow {
  id: string;
  leadName: string;
  /** null when the call never got a disposition (or an unknown legacy value). */
  outcome: CallOutcome | null;
  durationSec: number;
  startedAt: string;
}

/**
 * The latest calls placed against one campaign. Campaigns are org-shared, so
 * reads go org-wide via the service-role client when available (org_id pinned
 * in code), own-scoped otherwise — the same split as getCampaigns. Note
 * campaign_id is TEXT on call_records while campaigns.id is a uuid; the string
 * equality here matches how campaign-stats keys the same rows.
 */
export async function getCampaignRecentCalls(
  campaignId: string,
  limit = 10,
): Promise<CampaignCallRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const scope = await getScope();
    if (!scope) return [];
    // Org-wide is SUPERVISOR-only, like every sibling read (getBillsFine,
    // getCallbacks): these are row-level call records (who said what, when),
    // which RLS reserves for the row's owner or an org supervisor — a rep on
    // the campaign page sees their own calls, not the whole floor's.
    const useOrg = isAdminConfigured() && Boolean(scope.orgId) && scope.supervisor;
    const reader = useOrg ? createAdminClient() : await createClient();
    let q = reader
      .from("call_records")
      .select("id,lead_name,outcome,duration_sec,started_at")
      .eq(useOrg ? "org_id" : "owner_id", useOrg ? (scope.orgId as string) : scope.userId)
      .eq("campaign_id", campaignId);
    // A rep's "own" scope must stay within their CURRENT org — never surface
    // calls they happen to own from an org they've since left.
    if (!useOrg && scope.orgId) q = q.eq("org_id", scope.orgId);
    const { data, error } = await q
      .order("started_at", { ascending: false })
      .limit(Math.min(50, Math.max(1, Math.floor(limit))));
    if (error) {
      console.error("[pipeline] getCampaignRecentCalls failed:", error.message);
      return [];
    }
    return ((data ?? []) as Row[]).map((r) => ({
      id: s(r.id),
      // "" when the record carries no name — the PAGE substitutes the org's
      // own lead noun (vocabulary), never one vertical's word from down here.
      leadName: s(r.lead_name),
      outcome: r.outcome ? (s(r.outcome) as CallOutcome) : null,
      durationSec: Number(r.duration_sec ?? 0) || 0,
      startedAt: s(r.started_at),
    }));
  } catch (e) {
    console.error(
      "[pipeline] getCampaignRecentCalls failed:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

// ── Appointments ─────────────────────────────────────────────────────────────
export interface AppointmentRow {
  id: string;
  leadId: string | null;
  leadName: string;
  status: string;
  source: string;
  /** Which AI persona closed it: "primary" = Agent 1, "secondary" = Agent 2.
   *  null for rep-booked reviews and legacy AI rows from before attribution. */
  agent: "primary" | "secondary" | null;
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
    // The old `.limit(5000)` silently returned at most 1,000 (the PostgREST
    // ceiling) — page explicitly so the advertised ceiling is real. The
    // workspace needs the working set in memory for its calendar/bucket views.
    const rows = await fetchPagedUpTo(() => {
      let query = reader
        .from("appointments")
        .select("*")
        .eq(orgWide ? "org_id" : "owner_id", orgWide ? scope.orgId : scope.userId);
      // A rep's "own" scope must stay within their CURRENT org — never surface
      // appointments they happen to own from an org they've since left.
      if (!orgWide && scope.orgId) query = query.eq("org_id", scope.orgId);
      // `id` tiebreaker keeps the page windows stable when created_at collides.
      return query.order("created_at", { ascending: false }).order("id", { ascending: true });
    }, orgWide ? 5000 : 500);
    const names = orgWide ? await memberNames(scope.orgId as string) : null;

    // Batch the leads' contact details for the review lane + the email context.
    // Chunked: `.in()` lists ride in the request URL and responses cap at
    // 1,000 rows, so one giant list would truncate (or fail) past that.
    const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean).map(String))];
    const contacts = new Map<string, { phone: string; city: string; address: string }>();
    for (let i = 0; i < leadIds.length; i += 500) {
      const { data: ls } = await reader
        .from("leads")
        .select("id,phone,city,address,state,zip")
        .in("id", leadIds.slice(i, i + 500));
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
        agent:
          r.agent_key === "primary"
            ? "primary"
            : r.agent_key === "secondary"
              ? "secondary"
              : null,
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

export interface BillsFineResult {
  /** One page of the (possibly searched) book. */
  rows: BillsFineRow[];
  /** Count of EVERY row the scope + search match — not just this page. */
  total: number;
  /** Full-book count of rows carrying both bill amounts (same scope + search). */
  /** null = the count could not be READ, not zero. See askedCount. */
  withBills: number | null;
  /** Average combined monthly energy cost across `withBills` rows; null when none. */
  avgEnergyCost: number | null;
  /** Whether the viewer sees the whole org's book (drives the Team-wide badge). */
  teamWide: boolean;
}

const BILLS_FINE_COLS =
  "id,first_name,last_name,phone,address,utility_bill,solar_payment,utility_provider,last_contacted_at,created_at,owner_id";

/** How many with-bill rows the average is computed over before it becomes a sample. */
const BILLS_FINE_AVG_MAX = 5000;

export async function getBillsFine(
  opts: { page?: number; pageSize?: number; q?: string } = {},
): Promise<BillsFineResult> {
  const empty: BillsFineResult = {
    rows: [],
    total: 0,
    withBills: 0,
    avgEnergyCost: null,
    teamWide: false,
  };
  if (!isSupabaseConfigured()) return empty;
  try {
    const scope = await getScope();
    if (!scope) return empty;
    const orgWide = scope.supervisor && isAdminConfigured() && Boolean(scope.orgId);
    const reader = orgWide ? createAdminClient() : await createClient();

    const pageSize = Math.min(200, Math.max(1, Math.floor(opts.pageSize ?? 50)));
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const from = (page - 1) * pageSize;

    const term = sanitizeFilterTerm(opts.q ?? "");
    const digits = term.replace(/\D/g, "");

    // Apply the SAME scope/status/search filters to every query below, so the
    // counts describe exactly the book the list pages through. Builders aren't
    // reusable — this decorates a fresh one each time.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = (base: any) => {
      let q = base
        .eq(orgWide ? "org_id" : "owner_id", orgWide ? scope.orgId : scope.userId)
        .eq("status", "bills_fine");
      // A rep's "own" scope must stay within their CURRENT org — never surface
      // leads they happen to own from an org they've since left.
      if (!orgWide && scope.orgId) q = q.eq("org_id", scope.orgId);
      if (term) {
        const ors = [`first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`];
        if (digits) ors.push(`phone.ilike.%${digits}%`);
        q = q.or(ors.join(","));
      }
      return q;
    };

    const [pageRes, totalRes, withBillsRes] = await Promise.all([
      filtered(reader.from("leads").select(BILLS_FINE_COLS))
        .order("last_contacted_at", { ascending: false })
        // `id` tiebreaker keeps page windows stable when timestamps collide.
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1),
      filtered(reader.from("leads").select("id", { count: "exact", head: true })),
      filtered(reader.from("leads").select("id", { count: "exact", head: true }))
        .gt("utility_bill", 0)
        .gt("solar_payment", 0),
    ]);
    if (pageRes.error) console.error("[pipeline] getBillsFine query failed:", pageRes.error.message);
    if (totalRes.error) console.error("[pipeline] getBillsFine count failed:", totalRes.error.message);

    const rows = (pageRes.data ?? []) as Row[];
    // If the count query failed, fall back to what this page proves exists so
    // the UI never claims an empty book while showing rows.
    const total = totalRes.count ?? from + rows.length;
    const withBills = askedCount(withBillsRes);

    // Average combined energy cost over the whole (filtered) book. There's no
    // aggregate endpoint to lean on, so read just the two numeric columns in
    // bounded pages — exact up to BILLS_FINE_AVG_MAX with-bill rows, a large
    // deterministic sample beyond that.
    let avgEnergyCost: number | null = null;
    if (withBills === null || withBills > 0) {
      const billRows = await fetchPagedUpTo(
        () =>
          filtered(reader.from("leads").select("utility_bill,solar_payment"))
            .gt("utility_bill", 0)
            .gt("solar_payment", 0)
            .order("id", { ascending: true }),
        BILLS_FINE_AVG_MAX,
      );
      if (billRows.length) {
        const sum = billRows.reduce(
          (acc, r) => acc + Number(r.utility_bill ?? 0) + Number(r.solar_payment ?? 0),
          0,
        );
        avgEnergyCost = sum / billRows.length;
      }
    }

    const names = orgWide ? await memberNames(scope.orgId as string) : null;
    return {
      rows: rows.map((r) => ({
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
      })),
      total,
      withBills,
      avgEnergyCost,
      teamWide: orgWide,
    };
  } catch (e) {
    console.error("[pipeline] getBillsFine failed:", e instanceof Error ? e.message : e);
    return empty;
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

export interface CallbacksResult {
  /** Open callbacks only (completed/cancelled are excluded), soonest due first. */
  rows: CallbackRow[];
  /** Full-book count of completed callbacks — they never ride along as rows. */
  /** null = the count could not be READ, not zero. */
  completedCount: number | null;
  /** Whether the viewer sees the whole org's callbacks. */
  teamWide: boolean;
}

/** Open callbacks worth showing on the board — closed history stays in the DB. */
const CALLBACKS_MAX = 500;

export async function getCallbacks(): Promise<CallbacksResult> {
  const empty: CallbacksResult = { rows: [], completedCount: 0, teamWide: false };
  if (!isSupabaseConfigured()) return empty;
  try {
    const scope = await getScope();
    if (!scope) return empty;
    // Finalize any stuck calls first so callback-dispositioned ones show up.
    await reconcileOwnerActiveCalls();
    const orgWide = scope.supervisor && isAdminConfigured() && Boolean(scope.orgId);
    const reader = orgWide ? createAdminClient() : await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoped = (base: any) => {
      let q = base.eq(orgWide ? "org_id" : "owner_id", orgWide ? scope.orgId : scope.userId);
      // A rep's "own" scope must stay within their CURRENT org — never surface
      // callbacks they happen to own from an org they've since left.
      if (!orgWide && scope.orgId) q = q.eq("org_id", scope.orgId);
      return q;
    };
    // Closed rows accumulate forever — only OPEN work belongs on the board.
    // Statuses in play: rows insert as "due" (records.ts) and the page's ⋯ menu
    // writes "completed" | "cancelled" | "due" (dispositions.ts). Soonest due
    // first so a bounded read can never crowd today's queue out with history;
    // the Completed KPI comes from its own count so truncation can't skew it.
    const [listRes, doneRes] = await Promise.all([
      scoped(reader.from("callbacks").select("*"))
        .not("status", "in", '("completed","cancelled")')
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(CALLBACKS_MAX),
      scoped(reader.from("callbacks").select("id", { count: "exact", head: true })).eq(
        "status",
        "completed",
      ),
    ]);
    if (listRes.error) console.error("[pipeline] getCallbacks query failed:", listRes.error.message);
    if (doneRes.error)
      console.error("[pipeline] getCallbacks completed count failed:", doneRes.error.message);
    const names = orgWide ? await memberNames(scope.orgId as string) : null;
    return {
      rows: ((listRes.data ?? []) as Row[]).map((r) => ({
        id: s(r.id),
        leadId: r.lead_id ? s(r.lead_id) : null,
        // "" when the row carries no name — the callbacks PAGE substitutes the
        // org's own lead noun (vocabulary), not a hardcoded vertical's word.
        leadName: s(r.lead_name),
        phone: s(r.phone),
        reason: s(r.reason),
        status: s(r.status) || "due",
        dueAt: r.due_at ? s(r.due_at) : null,
        createdAt: s(r.created_at),
        repName: names ? names.get(s(r.owner_id)) || "Rep" : undefined,
        teamWide: orgWide,
      })),
      completedCount: askedCount(doneRes),
      teamWide: orgWide,
    };
  } catch (e) {
    console.error("[pipeline] getCallbacks failed:", e instanceof Error ? e.message : e);
    return empty;
  }
}
