import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import { logLeadEvent } from "./lead-events";
import { canActOn, getScope, type Scope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// Callback Workspace v2 — the board read + the claim/complete lifecycle.
//
// Two invariants the old /callbacks page broke, fixed here:
//
//  1. TWO REPS, ONE CALLBACK. "Call back" used to be a bare /dialer link, so
//     two people could execute the same promise minutes apart. Every dial now
//     goes through app_claim_callback (an atomic UPDATE … WHERE unclaimed OR
//     mine OR stale > 15 min), so exactly one person holds a callback at a
//     time — and a crashed tab releases it by going stale, not by a human
//     remembering to.
//
//  2. THE LOOP NEVER CLOSED. Finishing a callback-launched call left the
//     callback row open forever (or routeDisposition's cleanup DELETED it,
//     erasing the history). completeCallbackForLead() flips the row to
//     'completed' with attempt_count/last_attempt_at, called from
//     insertCallRecord when the disposition carries the callback id.
//
// POLICY NOTE (dialing, deliberately NOT wired here): a due callback bypasses
// cooldown / max-attempts through the eligibility engine's `dueCallbackLeadIds`
// input — that is already modeled in src/lib/dialer/eligibility.ts and the
// claim RPC, so this module adds NO eligibility logic of its own. And a
// callback NEVER bypasses DNC or the calling window: the dial route scrubs
// every number regardless of why it's being dialed.
//
// Lane derivation (overdue / due / upcoming, escalation tiers) is a CLIENT of
// this read — pure functions in src/lib/callbacks/lanes.ts — never a stored
// status. Stored statuses remain exactly 'due' | 'completed' | 'cancelled'.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Result = { ok: boolean; error?: string };
const s = (v: unknown) => (v == null ? "" : String(v));
const err = (error: string): Result => ({ ok: false, error });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One callback with the v2 columns resolved for display. */
export interface CallbackBoardRow {
  id: string;
  leadId: string | null;
  /** "" when the row carries no name — the PAGE substitutes the org's own
   *  lead noun (vocabulary), never one vertical's word from down here. */
  leadName: string;
  phone: string;
  reason: string;
  status: string;
  /** Floating wall-clock or null — parse with parseFloating, never new Date(). */
  dueAt: string | null;
  /** The contact's IANA timezone, when known — labels the due time honestly. */
  timezone: string;
  createdAt: string;
  priority: number;
  ownerId: string;
  repName: string;
  assignedTo: string | null;
  assignedToName: string;
  campaignId: string | null;
  campaignName: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  /** The call this callback came out of, if any. */
  callRecordId: string | null;
  claimedBy: string | null;
  claimedByName: string;
  /** Real timestamptz instant (unlike dueAt) — staleness math uses Date.parse. */
  claimedAt: string | null;
}

export interface CallbackBoard {
  /** Open rows (status 'due'), soonest due first, bounded. */
  open: CallbackBoardRow[];
  /** Completed/cancelled in the last 14 days, newest first, capped at 100. */
  closed: CallbackBoardRow[];
  /** Full-book count of completed callbacks (the KPI — truncation can't skew it). */
  completedCount: number;
  teamWide: boolean;
}

const EMPTY_BOARD: CallbackBoard = {
  open: [],
  closed: [],
  completedCount: 0,
  teamWide: false,
};

/** Open callbacks worth showing on the board — closed history stays bounded. */
const OPEN_MAX = 500;
const CLOSED_MAX = 100;
const CLOSED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** owner_id → display name for an org (to attribute rows + claims). */
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

/** campaign_id → name, for the board's campaign chips. */
async function campaignNames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reader: { from: (t: string) => any },
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const { data } = await reader
      .from("campaigns")
      .select("id,name")
      .in("id", ids.slice(0, 200));
    for (const r of (data ?? []) as Row[]) out.set(s(r.id), s(r.name));
  } catch {
    /* chips render as nothing — the board still works */
  }
  return out;
}

function mapRow(
  r: Row,
  names: Map<string, string> | null,
  campaigns: Map<string, string>,
): CallbackBoardRow {
  const ownerId = s(r.owner_id);
  const assignedTo = r.assigned_to ? s(r.assigned_to) : null;
  const claimedBy = r.claimed_by ? s(r.claimed_by) : null;
  const campaignId = r.campaign_id ? s(r.campaign_id) : null;
  return {
    id: s(r.id),
    leadId: r.lead_id ? s(r.lead_id) : null,
    leadName: s(r.lead_name),
    phone: s(r.phone),
    reason: s(r.reason),
    status: s(r.status) || "due",
    dueAt: r.due_at ? s(r.due_at) : null,
    timezone: s(r.timezone),
    createdAt: s(r.created_at),
    priority: Number(r.priority ?? 0) || 0,
    ownerId,
    repName: names ? names.get(ownerId) || "" : "",
    assignedTo,
    assignedToName: names && assignedTo ? names.get(assignedTo) || "" : "",
    campaignId,
    campaignName: campaignId ? campaigns.get(campaignId) || "" : "",
    attemptCount: Number(r.attempt_count ?? 0) || 0,
    lastAttemptAt: r.last_attempt_at ? s(r.last_attempt_at) : null,
    callRecordId: r.call_record_id ? s(r.call_record_id) : null,
    claimedBy,
    claimedByName: names && claimedBy ? names.get(claimedBy) || "" : "",
    claimedAt: r.claimed_at ? s(r.claimed_at) : null,
  };
}

/**
 * The whole workspace in one read: open rows + recently-closed history, with
 * every v2 column resolved (assignee/claimant names, campaign names). Scope
 * rules match the other pipeline reads — supervisors see the org, reps see
 * rows they OWN or are ASSIGNED (assigned_to is how a manager routes a
 * teammate's promise to whoever's on shift, so it must reach their board; the
 * service-role read is code-pinned to the org and the rep's own ids).
 */
export async function getCallbackBoard(scope: Scope | null): Promise<CallbackBoard> {
  if (!isSupabaseConfigured() || !scope) return EMPTY_BOARD;
  try {
    const orgWide = scope.supervisor && isAdminConfigured() && Boolean(scope.orgId);
    // Reps need assigned_to reach-through (rows they don't own); RLS on the
    // session client would silently drop those, so use the admin client when
    // available with the filter pinned in code — the same trade every org-wide
    // pipeline read makes.
    const repViaAdmin = !orgWide && isAdminConfigured() && Boolean(scope.orgId);
    const reader = orgWide || repViaAdmin ? createAdminClient() : await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoped = (base: any) => {
      if (orgWide) return base.eq("org_id", scope.orgId);
      let q = base;
      if (repViaAdmin) {
        q = q
          .eq("org_id", scope.orgId)
          .or(`owner_id.eq.${scope.userId},assigned_to.eq.${scope.userId}`);
      } else {
        // Session fallback (no service role): own rows only, pinned to the
        // CURRENT org so leftovers from a past org never surface.
        q = q.eq("owner_id", scope.userId);
        if (scope.orgId) q = q.eq("org_id", scope.orgId);
      }
      return q;
    };

    const closedCutoff = new Date(Date.now() - CLOSED_WINDOW_MS).toISOString();
    const [openRes, closedRes, doneRes] = await Promise.all([
      scoped(reader.from("callbacks").select("*"))
        .not("status", "in", '("completed","cancelled")')
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(OPEN_MAX),
      // "Recently closed" keys off last_attempt_at when the completion stamped
      // one, created_at otherwise (cancelled rows / legacy completions).
      scoped(reader.from("callbacks").select("*"))
        .in("status", ["completed", "cancelled"])
        .or(`last_attempt_at.gte.${closedCutoff},created_at.gte.${closedCutoff}`)
        .order("last_attempt_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(CLOSED_MAX),
      scoped(reader.from("callbacks").select("id", { count: "exact", head: true })).eq(
        "status",
        "completed",
      ),
    ]);
    if (openRes.error)
      console.error("[callbacks] board open read failed:", openRes.error.message);
    if (closedRes.error)
      console.error("[callbacks] board closed read failed:", closedRes.error.message);

    // Names resolve whenever we can (claims + assignees matter to reps too,
    // not just supervisors) — display names of teammates, nothing more.
    const names =
      scope.orgId && isAdminConfigured() ? await memberNames(scope.orgId) : null;
    const openRows = (openRes.data ?? []) as Row[];
    const closedRows = (closedRes.data ?? []) as Row[];
    const campaignIds = [
      ...new Set(
        [...openRows, ...closedRows].map((r) => s(r.campaign_id)).filter(Boolean),
      ),
    ];
    const campaigns = await campaignNames(reader, campaignIds);

    return {
      open: openRows.map((r) => mapRow(r, names, campaigns)),
      closed: closedRows.map((r) => mapRow(r, names, campaigns)),
      completedCount: doneRes.count ?? 0,
      teamWide: orgWide,
    };
  } catch (e) {
    console.error("[callbacks] getCallbackBoard failed:", e instanceof Error ? e.message : e);
    return EMPTY_BOARD;
  }
}

/** Load a callback for a write + confirm the actor may touch it. */
async function authorize(
  id: string,
): Promise<
  | { admin: ReturnType<typeof createAdminClient>; scope: Scope; row: Row }
  | { error: string }
> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return { error: "Not configured." };
  const scope = await getScope();
  if (!scope) return { error: "You must be signed in." };
  const admin = createAdminClient();
  const { data } = await admin
    .from("callbacks")
    .select("id, owner_id, org_id, assigned_to, lead_id, lead_name, claimed_by, claimed_at, status")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { error: "Callback not found." };
  const row = data as Row;
  const assignedToMe = s(row.assigned_to) === scope.userId;
  if (!assignedToMe && !canActOn(scope, s(row.owner_id) || null, row.org_id ? s(row.org_id) : null))
    return { error: "You don't have access to this callback." };
  return { admin, scope, row };
}

export interface ClaimResult {
  ok: boolean;
  /** false = a teammate holds a live claim — do NOT dial. */
  claimed: boolean;
  /** Who holds it, for the "being worked by" toast. */
  claimedByName?: string;
  error?: string;
}

/**
 * Atomically claim a callback before dialing it. Goes through the
 * app_claim_callback RPC — never a read-then-write — so two reps clicking
 * "Call back" in the same second get exactly one true. `userId` must be the
 * session user (the route passes scope.userId; re-checked here).
 */
export async function claimCallback(id: string, userId: string): Promise<ClaimResult> {
  const auth = await authorize(id);
  if ("error" in auth) return { ok: false, claimed: false, error: auth.error };
  if (auth.scope.userId !== userId)
    return { ok: false, claimed: false, error: "Claim must be your own session." };
  try {
    const { data, error } = await auth.admin.rpc("app_claim_callback", {
      p_id: id,
      p_user: userId,
    });
    if (error) return { ok: false, claimed: false, error: error.message };
    if (data === true) return { ok: true, claimed: true };
    // Lost the race (or the row isn't open) — name the holder for the toast.
    const { data: holder } = await auth.admin
      .from("callbacks")
      .select("claimed_by")
      .eq("id", id)
      .maybeSingle();
    let claimedByName = "";
    const holderId = holder?.claimed_by ? String(holder.claimed_by) : null;
    if (holderId && auth.scope.orgId) {
      claimedByName = (await memberNames(auth.scope.orgId)).get(holderId) ?? "";
    }
    return { ok: true, claimed: false, claimedByName };
  } catch (e) {
    return {
      ok: false,
      claimed: false,
      error: e instanceof Error ? e.message : "Claim failed.",
    };
  }
}

/** Let go of a claim I hold (backing out without dialing). Only clears MINE. */
export async function releaseCallback(id: string, userId: string): Promise<Result> {
  const auth = await authorize(id);
  if ("error" in auth) return err(auth.error);
  if (auth.scope.userId !== userId) return err("Release must be your own session.");
  const { error } = await auth.admin
    .from("callbacks")
    .update({ claimed_by: null, claimed_at: null })
    .eq("id", id)
    .eq("claimed_by", userId);
  return error ? err(error.message) : { ok: true };
}

/**
 * Close the loop on a callback-launched call: mark the lead's OPEN callback(s)
 * completed, count the attempt, stamp when, and release any claim. Admin
 * client on purpose — a claimed team callback is often OWNED by another rep,
 * and the session client's RLS silently skipping it is exactly the old
 * "completing the call never closes the callback" bug.
 *
 * `callbackId` (when the dial was launched from the board) also completes that
 * specific row even if its lead link is absent — but never a row whose lead_id
 * DISAGREES with the dispositioned lead: the rep wandered off to another
 * contact, and their callback promise is still unkept.
 *
 * `call_record_id` is the SOURCE call (set when the callback is created), so
 * completion only backfills it on legacy rows that have none.
 */
export async function completeCallbackForLead(
  leadId: string | null,
  callRecordId: string | null,
  callbackId?: string | null,
): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    const targets = new Map<string, Row>();
    if (callbackId && UUID.test(callbackId)) {
      const { data } = await admin
        .from("callbacks")
        .select("id, lead_id, attempt_count, call_record_id")
        .eq("id", callbackId)
        .not("status", "in", '("completed","cancelled")')
        .maybeSingle();
      if (data) {
        const rowLead = data.lead_id ? String(data.lead_id) : null;
        if (!rowLead || !leadId || rowLead === leadId) targets.set(String(data.id), data as Row);
      }
    }
    if (leadId && UUID.test(leadId)) {
      const { data } = await admin
        .from("callbacks")
        .select("id, lead_id, attempt_count, call_record_id")
        .eq("lead_id", leadId)
        .not("status", "in", '("completed","cancelled")');
      for (const r of (data ?? []) as Row[]) targets.set(s(r.id), r);
    }
    const now = new Date().toISOString();
    for (const [id, r] of targets) {
      await admin
        .from("callbacks")
        .update({
          status: "completed",
          attempt_count: (Number(r.attempt_count ?? 0) || 0) + 1,
          last_attempt_at: now,
          claimed_by: null,
          claimed_at: null,
          ...(r.call_record_id || !callRecordId ? {} : { call_record_id: callRecordId }),
        })
        .eq("id", id);
    }
  } catch {
    /* best-effort — the disposition itself must never fail on this */
  }
}

/**
 * Route a callback to a different rep (manager+ — same permission that gates
 * lead assignment, `assignments.manage`, checked by the API route; this layer
 * re-checks supervisor scope). Sets `assigned_to` (owner_id stays: it records
 * who the promise was made BY; assigned_to records who executes it).
 */
export async function reassignCallback(id: string, toUserId: string): Promise<Result> {
  const auth = await authorize(id);
  if ("error" in auth) return err(auth.error);
  if (!auth.scope.supervisor) return err("Only managers can reassign callbacks.");
  if (!UUID.test(toUserId)) return err("Pick a teammate to reassign to.");
  if (auth.scope.orgId) {
    const { data: member } = await auth.admin
      .from("organization_members")
      .select("user_id")
      .eq("org_id", auth.scope.orgId)
      .eq("user_id", toUserId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return err("That teammate isn't an active member of this workspace.");
  }
  const { error } = await auth.admin
    .from("callbacks")
    .update({ assigned_to: toUserId, claimed_by: null, claimed_at: null })
    .eq("id", id);
  if (error) return err(error.message);
  // Timeline breadcrumb on the lead, mirroring pack assignment's audit habit.
  const leadId = auth.row.lead_id ? s(auth.row.lead_id) : null;
  if (leadId) {
    logLeadEvent({
      leadId,
      actorId: auth.scope.userId,
      kind: "assignment",
      payload: { what: "callback", callbackId: id, to: toUserId },
    });
  }
  return { ok: true };
}

/** Set a callback's priority (manager+). Clamped to the flag range 0–3. */
export async function setCallbackPriority(id: string, priority: number): Promise<Result> {
  const auth = await authorize(id);
  if ("error" in auth) return err(auth.error);
  if (!auth.scope.supervisor) return err("Only managers can change priority.");
  const n = Math.max(0, Math.min(3, Math.round(Number(priority) || 0)));
  const { error } = await auth.admin.from("callbacks").update({ priority: n }).eq("id", id);
  return error ? err(error.message) : { ok: true };
}

/**
 * Move a callback to a new agreed time (or clear it — "no time agreed").
 * Re-opens a cancelled row: rescheduling IS the statement that it's live again.
 */
export async function rescheduleCallback(
  id: string,
  dueAt: string | null,
  reason?: string,
): Promise<Result> {
  const auth = await authorize(id);
  if ("error" in auth) return err(auth.error);
  // Floating wall-clock shape only — an offset here would shift the promise.
  if (dueAt != null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(dueAt))
    return err("Invalid time.");
  const update: Row = { due_at: dueAt, status: "due" };
  if (typeof reason === "string" && reason.trim()) update.reason = reason.trim().slice(0, 500);
  const { error } = await auth.admin.from("callbacks").update(update).eq("id", id);
  return error ? err(error.message) : { ok: true };
}
