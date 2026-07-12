import "server-only";

import { CONNECTED_OUTCOMES } from "../call-analytics";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { CallOutcome } from "../types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v?: string | null) => (v && UUID.test(v) ? v : null);

// outcome → lead status (shared by every disposition path).
const OUTCOME_TO_STATUS: Record<CallOutcome, string> = {
  appointment_booked: "appointment",
  callback_scheduled: "callback",
  qualified: "qualified",
  not_interested: "not_interested",
  bills_fine: "bills_fine",
  no_answer: "no_answer",
  voicemail: "no_answer",
  wrong_number: "no_answer",
  do_not_call: "dnc",
};

/**
 * Route a disposition to the right pipeline tab. appointment_booked → the
 * Appointments tab, callback_scheduled → the Callbacks tab. "Latest disposition
 * wins" per lead, so re-dispositioning a lead moves it cleanly between tabs
 * instead of leaving stale rows. Works with the admin OR the session client.
 */
async function routeDisposition(
  // Minimal shape shared by the admin + session Supabase clients (chainable
  // query builder); typed loosely so both client flavors satisfy it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (table: string) => any },
  input: {
    ownerId: string;
    leadId: string | null;
    leadName: string;
    phone: string;
    outcome: CallOutcome;
    summary?: string;
    appointment?: { when: string; iso?: string; notes: string } | null;
    source: "ai" | "rep";
  },
): Promise<void> {
  const { ownerId, leadId, outcome } = input;

  // Clear this lead's pending pipeline items so the newest disposition wins.
  if (leadId) {
    await client.from("callbacks").delete().eq("lead_id", leadId).neq("status", "completed");
    await client.from("appointments").delete().eq("lead_id", leadId).eq("status", "scheduled");
  }

  if (outcome === "appointment_booked" || input.appointment) {
    await client.from("appointments").insert({
      owner_id: ownerId,
      lead_id: leadId,
      lead_name: input.leadName,
      // Machine timestamp (drives the calendar + time buckets) when the resolver
      // pinned a concrete slot; the human label is always kept for display.
      scheduled_at: input.appointment?.iso || null,
      scheduled_label: input.appointment?.when ?? "",
      notes: input.appointment?.notes ?? input.summary ?? "",
      source: input.source,
      status: "scheduled",
      // AI bookings are proposals pending human approval; rep-created are final.
      approved: input.source !== "ai",
    });
  } else if (outcome === "callback_scheduled") {
    await client.from("callbacks").insert({
      owner_id: ownerId,
      lead_id: leadId,
      lead_name: input.leadName,
      phone: input.phone,
      reason: input.summary || "Callback requested",
      status: "due",
    });
  }
}

// ── Human call dispositions ──────────────────────────────────────────────────
export async function insertCallRecord(input: {
  leadId?: string | null;
  leadName?: string;
  phone?: string;
  durationSec?: number;
  outcome?: CallOutcome;
  channel?: "human" | "ai";
  summary?: string;
  callSid?: string | null;
  /** Conference room (`hc-<id>`) for manual calls — links the recording. */
  room?: string | null;
  /** Rep's free-text call notes — persisted back to leads.notes. */
  notes?: string;
}): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const leadUuid = asUuid(input.leadId);

    // Tag the call with the lead's campaign so reports + the campaigns tab can
    // slice performance per campaign.
    let campaignId: string | null = null;
    if (leadUuid) {
      const { data: l } = await supabase
        .from("leads")
        .select("campaign_id")
        .eq("id", leadUuid)
        .maybeSingle();
      campaignId = (l?.campaign_id as string) ?? null;
    }

    const { data: rec } = await supabase.from("call_records").insert({
      owner_id: user.id,
      lead_id: leadUuid,
      lead_name: input.leadName ?? "",
      phone: input.phone ?? "",
      duration_sec: input.durationSec ?? 0,
      outcome: input.outcome ?? null,
      channel: input.channel ?? "human",
      summary: input.summary ?? null,
      call_sid: input.callSid ?? null,
      room: input.room ?? null,
      campaign_id: campaignId,
    }).select("id").maybeSingle();
    const recordId = (rec as { id?: string } | null)?.id ?? null;

    // Claim a recording that finished before this record existed (the rep was
    // still wrapping up when the conference recording webhook fired).
    if (recordId && input.room && isAdminConfigured()) {
      try {
        const admin = createAdminClient();
        const { data: pending } = await admin
          .from("pending_recordings")
          .select("recording_url")
          .eq("room", input.room)
          .maybeSingle();
        const pendingUrl = (pending as { recording_url?: string } | null)?.recording_url;
        if (pendingUrl) {
          await admin
            .from("call_records")
            .update({ recording_url: pendingUrl })
            .eq("id", recordId);
          await admin.from("pending_recordings").delete().eq("room", input.room);
        }
      } catch {
        /* best-effort */
      }
    }

    if (!input.outcome) return recordId;

    // Reflect the disposition on the lead + route it to the right pipeline tab.
    if (leadUuid) {
      await supabase
        .from("leads")
        .update({
          status: OUTCOME_TO_STATUS[input.outcome] ?? "contacted",
          last_contacted_at: new Date().toISOString(),
          ...(input.notes != null ? { notes: input.notes } : {}),
        })
        .eq("id", leadUuid);
    }
    await routeDisposition(supabase, {
      ownerId: user.id,
      leadId: leadUuid,
      leadName: input.leadName ?? "",
      phone: input.phone ?? "",
      outcome: input.outcome,
      summary: input.summary,
      source: input.channel === "ai" ? "ai" : "rep",
    });
    return recordId ?? null;
  } catch {
    return null;
    /* best-effort */
  }
}

/**
 * Read the lead_id + phone seeded for a conversation, using the service-role
 * client (no session — webhook path). Lets the post-call pipeline recover the
 * lead for analysis even when the in-memory store was lost to instance churn.
 */
export async function getConversationLeadRef(
  conversationId: string,
): Promise<{ leadId: string | null; phone: string } | null> {
  if (!isAdminConfigured()) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("ai_conversations")
      .select("lead_id, phone")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (!data) return null;
    return {
      leadId: (data.lead_id as string) ?? null,
      phone: (data.phone as string) ?? "",
    };
  } catch {
    return null;
  }
}

// ── AI conversation: seed at call placement (user session present) ───────────
export async function seedAIConversation(input: {
  conversationId: string;
  callSid: string | null;
  leadId: string | null;
  leadName: string;
  phone: string;
  /** Which override fields actually went out — forensics for a killed call. */
  overrideMode?: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("ai_conversations").upsert({
      conversation_id: input.conversationId,
      owner_id: user.id,
      lead_id: asUuid(input.leadId),
      lead_name: input.leadName,
      phone: input.phone,
      call_sid: input.callSid,
      override_mode: input.overrideMode ?? null,
      state: "initiated",
    });
  } catch {
    /* best-effort */
  }
}

export interface StuckConversation {
  conversationId: string;
  startedAt: number;
}

/**
 * Every AI conversation that never reached a terminal state — global,
 * service-role, OLDEST-FIRST, keyset-paged. For the cron reconciler ONLY.
 *
 * Deliberately not reusing getAIConversationsForMonitor(): that one is scoped to
 * the viewer, orders newest-first, and caps rows BEFORE filtering to active. Once
 * a backlog grows past the cap the oldest stuck calls fall out of the window and
 * can never be seen again — they're stuck forever, by construction. Draining a
 * backlog requires going oldest-first with a cursor.
 */
export async function listStuckAIConversations(opts: {
  olderThanMs: number;
  limit: number;
  after?: string | null;
}): Promise<{ rows: StuckConversation[]; nextCursor: string | null }> {
  if (!isAdminConfigured()) return { rows: [], nextCursor: null };
  try {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - opts.olderThanMs).toISOString();
    let q = admin
      .from("ai_conversations")
      .select("conversation_id, started_at")
      .in("state", ["initiated", "in_progress"])
      .lt("started_at", cutoff);
    if (opts.after) q = q.gt("started_at", opts.after);

    const { data } = await q
      .order("started_at", { ascending: true })
      .limit(opts.limit);

    const raw = (data ?? []) as Record<string, unknown>[];
    const rows = raw.map((r) => ({
      conversationId: String(r.conversation_id),
      startedAt: Date.parse(String(r.started_at)),
    }));
    const last = raw[raw.length - 1];
    return {
      rows,
      nextCursor: rows.length === opts.limit && last ? String(last.started_at) : null,
    };
  } catch {
    return { rows: [], nextCursor: null };
  }
}

/** How many AI conversations are stuck mid-flight (for the health endpoint). */
export async function countStuckAIConversations(): Promise<number> {
  if (!isAdminConfigured()) return 0;
  try {
    const { count } = await createAdminClient()
      .from("ai_conversations")
      .select("conversation_id", { count: "exact", head: true })
      .in("state", ["initiated", "in_progress"]);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Calls in the last 24h that the provider killed on connect — the outage
 * signature. Zero is healthy; anything else means homeowners are answering and
 * being hung up on.
 */
export async function countKillSignature24h(): Promise<number> {
  if (!isAdminConfigured()) return 0;
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await createAdminClient()
      .from("call_records")
      .select("id", { count: "exact", head: true })
      .in("failure_kind", ["provider_quota_exceeded", "agent_terminated_on_connect"])
      .gte("started_at", since);
    return count ?? 0;
  } catch {
    return 0;
  }
}

// ── AI conversation: complete from the webhook (no session → admin client) ───
export async function completeAIConversation(input: {
  conversationId: string;
  summary: string;
  /**
   * null when the call failed for a SYSTEM reason (see `failureKind`) rather than
   * a homeowner one — e.g. the provider ran out of credits and hung up on the
   * homeowner mid-greeting. A null outcome is excluded from every rate
   * denominator, and (see below) must NOT re-file the lead.
   */
  outcome: CallOutcome | null;
  failureKind?: string | null;
  terminationReason?: string | null;
  sentiment: string;
  durationSec?: number;
  appointment?: { when: string; iso?: string; notes: string } | null;
  /** "failed" for calls that never connected; defaults to "completed". */
  state?: "completed" | "failed";
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("ai_conversations")
      .select("owner_id, lead_id, lead_name, phone, call_sid, state, outcome, started_at")
      .eq("conversation_id", input.conversationId)
      .maybeSingle();

    // Idempotent — EXCEPT we always allow upgrading a not-connected/failed record
    // to a real (connected) outcome. This is the safety net for the race where
    // the live detail route files "no answer" before the transcript has loaded:
    // the post-call webhook (full transcript) then corrects it here.
    const prevState = existing?.state as string | undefined;
    const prevOutcome = (existing?.outcome as CallOutcome | null) ?? null;
    const isFinal = prevState === "completed" || prevState === "failed";
    const prevConnected =
      prevState === "completed" &&
      prevOutcome != null &&
      CONNECTED_OUTCOMES.has(prevOutcome);
    const newConnected =
      input.state !== "failed" &&
      input.outcome != null &&
      CONNECTED_OUTCOMES.has(input.outcome);
    if (isFinal && !(newConnected && !prevConnected)) return;
    const upgrading = isFinal;

    await admin
      .from("ai_conversations")
      .update({
        state: input.state ?? "completed",
        summary: input.summary,
        outcome: input.outcome,
        failure_kind: input.failureKind ?? null,
        termination_reason: input.terminationReason ?? null,
        sentiment: input.sentiment,
        duration_sec: input.durationSec ?? null,
        appointment: input.appointment ?? null,
        ended_at: new Date().toISOString(),
      })
      .eq("conversation_id", input.conversationId);

    const ownerId = existing?.owner_id as string | undefined;
    if (!ownerId) return;

    // Only create the call record if one doesn't already exist for this convo.
    const { data: existingRec } = await admin
      .from("call_records")
      .select("id")
      .eq("conversation_id", input.conversationId)
      .maybeSingle();

    if (!existingRec) {
      // Tag the AI call with the lead's campaign for per-campaign reporting.
      let campaignId: string | null = null;
      if (existing?.lead_id) {
        const { data: l } = await admin
          .from("leads")
          .select("campaign_id")
          .eq("id", existing.lead_id)
          .maybeSingle();
        campaignId = (l?.campaign_id as string) ?? null;
      }
      await admin.from("call_records").insert({
        owner_id: ownerId,
        lead_id: existing?.lead_id ?? null,
        lead_name: existing?.lead_name ?? "",
        // phone + call_sid were never carried onto AI rows, so an AI call could
        // not be joined to its Twilio leg at all.
        phone: (existing?.phone as string) ?? "",
        call_sid: (existing?.call_sid as string) ?? null,
        // The DIAL time, copied from the conversation — not now().
        //
        // call_records.started_at defaults to now() and this insert never set it,
        // so an AI call was stamped with the moment it was FINALIZED. Calls dialed
        // on Jun 29 carry a started_at of Jul 6 in production: seven days of drift.
        // That put every AI call in the wrong reporting window.
        started_at: (existing?.started_at as string) ?? new Date().toISOString(),
        duration_sec: input.durationSec ?? 0,
        outcome: input.outcome,
        failure_kind: input.failureKind ?? null,
        termination_reason: input.terminationReason ?? null,
        channel: "ai",
        conversation_id: input.conversationId,
        summary: input.summary,
        sentiment: input.sentiment,
        campaign_id: campaignId,
      });
    } else if (upgrading) {
      // Correct the previously-filed (e.g. no-answer) record with the real result.
      await admin
        .from("call_records")
        .update({
          outcome: input.outcome,
          failure_kind: input.failureKind ?? null,
          termination_reason: input.terminationReason ?? null,
          summary: input.summary,
          sentiment: input.sentiment,
          duration_sec: input.durationSec ?? 0,
        })
        .eq("id", existingRec.id);
    }

    // A SYSTEM failure (outcome === null) says nothing about the homeowner, so it
    // must not re-file them: no lead-status change, no pipeline routing. A lead
    // the agent hung up on — or one whose phone never rang — stays exactly where
    // it was, still due for a real attempt. Routing these would quietly bury
    // thousands of un-called leads as "no answer".
    if (input.outcome == null) return;

    // Route the disposition to the right pipeline tab (Appointments / Callbacks).
    await routeDisposition(admin, {
      ownerId,
      leadId: (existing?.lead_id as string) ?? null,
      leadName: (existing?.lead_name as string) ?? "",
      phone: (existing?.phone as string) ?? "",
      outcome: input.outcome,
      summary: input.summary,
      appointment: input.appointment ?? null,
      source: "ai",
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Advance a conversation to "in_progress" the moment it connects, durably (admin
 * client, no session needed). Keeps the row truthful across serverless instances
 * so a connected call never looks like it "hasn't started" in the monitor. Only
 * advances from "initiated" — never downgrades a terminal/active row.
 */
export async function markAIConversationActive(
  conversationId: string,
): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    await admin
      .from("ai_conversations")
      .update({ state: "in_progress" })
      .eq("conversation_id", conversationId)
      .eq("state", "initiated");
  } catch {
    /* best-effort */
  }
}

// ── Lead enrichment from an AI call (admin; processes extracted data) ────────
/**
 * Write the data the AI extracted from a call back onto the lead — utility bill,
 * solar payment, EV/pool/battery, an AI score, and a status derived from the
 * disposition. Resolves the lead from the conversation so it works without a
 * session (webhook path). Best-effort; never throws.
 */
export async function enrichLeadFromAI(input: {
  conversationId: string;
  outcome: CallOutcome;
  score?: number | null;
  qualification?: {
    utilityBill: number | null;
    solarPayment: number | null;
    hasEV: boolean;
    hasPool: boolean;
    hasBattery: boolean;
  };
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data: convo } = await admin
      .from("ai_conversations")
      .select("lead_id")
      .eq("conversation_id", input.conversationId)
      .maybeSingle();
    const leadId = convo?.lead_id as string | undefined;
    if (!leadId) return;

    const patch: Record<string, unknown> = {
      status: OUTCOME_TO_STATUS[input.outcome] ?? "contacted",
      last_contacted_at: new Date().toISOString(),
    };
    if (input.score != null) patch.ai_score = Math.round(input.score);
    const q = input.qualification;
    if (q) {
      if (q.utilityBill != null && q.utilityBill > 0) patch.utility_bill = q.utilityBill;
      if (q.solarPayment != null && q.solarPayment > 0) patch.solar_payment = q.solarPayment;
      if (q.hasEV) patch.has_ev = true;
      if (q.hasPool) patch.has_pool = true;
      if (q.hasBattery) patch.has_battery = true;
    }
    await admin.from("leads").update(patch).eq("id", leadId);
  } catch {
    /* best-effort */
  }
}

// ── Single conversation read (account-scoped) ────────────────────────────────
export interface AIConversationRow {
  conversationId: string;
  leadName: string;
  phone: string;
  state: string;
  sentiment: string;
  outcome: string | null;
  summary: string;
  durationSec: number | null;
  recordingAvailable: boolean;
  callSid: string | null;
  appointment: { when: string; notes: string } | null;
}

export async function getAIConversation(
  conversationId: string,
): Promise<AIConversationRow | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("ai_conversations")
      .select("*")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (!data) return null;
    return {
      conversationId,
      leadName: (data.lead_name as string) ?? "",
      phone: (data.phone as string) ?? "",
      state: (data.state as string) ?? "completed",
      sentiment: (data.sentiment as string) ?? "neutral",
      outcome: (data.outcome as string) ?? null,
      summary: (data.summary as string) ?? "",
      durationSec: (data.duration_sec as number) ?? null,
      recordingAvailable: data.state === "completed",
      callSid: (data.call_sid as string) ?? null,
      appointment:
        (data.appointment as { when: string; notes: string } | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Apply a human-chosen disposition to a lead (admin client; caller has already
 * authorized the actor). Re-files the lead: updates its status, corrects the
 * lead's most recent call record so reports reflect the change, and routes it to
 * the right pipeline tab (clearing the stale appointment/callback). Shared by the
 * Appointments/Callbacks override controls.
 */
export async function applyManualDisposition(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (t: string) => any },
  input: {
    lead: {
      id: string;
      owner_id: string;
      first_name?: string | null;
      last_name?: string | null;
      phone?: string | null;
    };
    outcome: CallOutcome;
    actorLabel?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { lead, outcome } = input;
    const leadName =
      `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Homeowner";
    await admin
      .from("leads")
      .update({
        status: OUTCOME_TO_STATUS[outcome] ?? "contacted",
        last_contacted_at: new Date().toISOString(),
      })
      .eq("id", lead.id);

    // Correct the lead's most recent call record so dispositions/reports update.
    const { data: rec } = await admin
      .from("call_records")
      .select("id")
      .eq("lead_id", lead.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rec) {
      await admin.from("call_records").update({ outcome }).eq("id", rec.id);
    } else {
      await admin.from("call_records").insert({
        owner_id: lead.owner_id,
        lead_id: lead.id,
        lead_name: leadName,
        outcome,
        channel: "human",
        summary: input.actorLabel ?? "Manually dispositioned",
      });
    }

    await routeDisposition(admin, {
      ownerId: lead.owner_id,
      leadId: lead.id,
      leadName,
      phone: lead.phone ?? "",
      outcome,
      summary: input.actorLabel ?? "Manually re-dispositioned",
      source: "rep",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function setConversationDisposition(
  conversationId: string,
  outcome: CallOutcome,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured())
    return { ok: false, error: "Connect Supabase to save dispositions." };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "You must be signed in." };

    const { data: convo } = await supabase
      .from("ai_conversations")
      .select("lead_id, lead_name, phone, duration_sec")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    await supabase
      .from("ai_conversations")
      .update({ outcome, state: "completed", ended_at: new Date().toISOString() })
      .eq("conversation_id", conversationId);

    const { data: rec } = await supabase
      .from("call_records")
      .select("id")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (rec) {
      await supabase.from("call_records").update({ outcome }).eq("id", rec.id);
    } else {
      await supabase.from("call_records").insert({
        owner_id: user.id,
        lead_id: convo?.lead_id ?? null,
        lead_name: convo?.lead_name ?? "",
        duration_sec: convo?.duration_sec ?? 0,
        outcome,
        channel: "ai",
        conversation_id: conversationId,
        summary: "Manually dispositioned by supervisor",
      });
    }

    // Reflect the override on the lead + move it to the right pipeline tab.
    const leadUuid = asUuid((convo?.lead_id as string) ?? null);
    if (leadUuid) {
      await supabase
        .from("leads")
        .update({
          status: OUTCOME_TO_STATUS[outcome] ?? "contacted",
          last_contacted_at: new Date().toISOString(),
        })
        .eq("id", leadUuid);
    }
    await routeDisposition(supabase, {
      ownerId: user.id,
      leadId: leadUuid,
      leadName: (convo?.lead_name as string) ?? "",
      phone: (convo?.phone as string) ?? "",
      outcome,
      summary: "Set by supervisor",
      source: "ai",
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

// ── Monitor feed (durable, account-scoped) ───────────────────────────────────
export interface MonitorAICall {
  conversationId: string;
  callSid: string | null;
  leadName: string;
  phone: string;
  city: string;
  state: "initiated" | "in_progress" | "completed" | "failed";
  sentiment: "positive" | "neutral" | "negative";
  startedAt: number;
  endedAt?: number;
  durationSec?: number;
  summary?: string;
  outcome?: CallOutcome | null;
  recordingAvailable?: boolean;
}

/**
 * The Live Monitor feed read straight from Supabase, so AI calls survive
 * serverless instance churn and page refreshes (the in-memory store alone
 * doesn't). Merged with the live store in the conversations API.
 */
export async function getAIConversationsForMonitor(): Promise<{
  active: MonitorAICall[];
  recent: MonitorAICall[];
}> {
  if (!isSupabaseConfigured()) return { active: [], recent: [] };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { active: [], recent: [] };

    // Supervisors (owner/admin/manager) see the whole org's AI calls, same
    // scoping every other monitor/reporting query in this app uses — this was
    // previously owner_id-only unconditionally, so a manager only ever saw
    // calls THEY personally placed, never their reps'. RLS already permits an
    // org supervisor to read org-wide rows via the session client (see the
    // "ai_conversations read" policy in schema.sql), so no service role
    // is required here.
    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const supervisor =
      Boolean(orgId) && ["owner", "admin", "manager"].includes(String(prof?.role ?? "rep"));

    const base = supabase
      .from("ai_conversations")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(supervisor ? 100 : 50);
    const { data, error } = supervisor
      ? await base.eq("org_id", orgId as string)
      : await base.eq("owner_id", user.id);
    if (error) {
      console.error("[records] getAIConversationsForMonitor failed:", error.message);
      return { active: [], recent: [] };
    }

    const map = (r: Record<string, unknown>): MonitorAICall => {
      const state = String(r.state ?? "completed") as MonitorAICall["state"];
      const sentiment = (["positive", "negative"].includes(String(r.sentiment))
        ? String(r.sentiment)
        : "neutral") as MonitorAICall["sentiment"];
      return {
        conversationId: String(r.conversation_id),
        callSid: (r.call_sid as string) ?? null,
        leadName: String(r.lead_name ?? ""),
        phone: String(r.phone ?? ""),
        city: "",
        state,
        sentiment,
        startedAt: r.started_at ? Date.parse(String(r.started_at)) : Date.now(),
        endedAt: r.ended_at ? Date.parse(String(r.ended_at)) : undefined,
        durationSec: r.duration_sec == null ? undefined : Number(r.duration_sec),
        summary: (r.summary as string) ?? undefined,
        outcome: (r.outcome as CallOutcome) ?? null,
        recordingAvailable: state === "completed",
      };
    };

    const all = (data ?? []).map(map);
    return {
      active: all.filter(
        (c) => c.state === "initiated" || c.state === "in_progress",
      ),
      recent: all
        .filter((c) => c.state === "completed" || c.state === "failed")
        .slice(0, 8),
    };
  } catch {
    return { active: [], recent: [] };
  }
}
