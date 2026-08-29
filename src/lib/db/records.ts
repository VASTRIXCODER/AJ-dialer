import "server-only";

import { CONNECTED_OUTCOMES } from "../call-analytics";
import { recordDispositionFiled } from "../calls/apply-event";
import { zonedDayStartMs } from "../dialer/schedule";
import { orgTimezone } from "../metrics/definitions";
import { publishOrgEvent } from "../realtime/publish";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import {
  type AILiveState,
  type CallOutcome,
  isTerminalLiveState,
  LIVE_STATES,
} from "../types";
import { completeCallbackForLead } from "./callbacks";
import { addToDnc } from "./dnc";
import { logLeadEvent } from "./lead-events";
import { markLeadAttempted } from "./reservations";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v?: string | null) => (v && UUID.test(v) ? v : null);

/**
 * A turn array flattened to searchable plain text, stored alongside the call.
 *
 * The structured turns stay on `ai_conversations` and still render the chat
 * bubbles; this is the copy the archive searches, snippets, and hands to
 * "download transcript". Keeping it on `call_records` is what makes a transcript
 * findable at all — before, the only way to read one was to already know which
 * call to open.
 */
export function flattenTranscript(
  turns: { role: string; message: string; secs?: number | null }[] | null | undefined,
): string | null {
  if (!Array.isArray(turns) || turns.length === 0) return null;
  const text = turns
    .map((t) => {
      const who = t.role === "agent" ? "Agent" : "Contact";
      // Internal newlines are collapsed so one turn is always one line. That
      // keeps the round-trip lossless: the detail view splits this back into
      // speaker bubbles, and a turn that spanned two lines would otherwise come
      // back as an unattributed fragment.
      const line = String(t.message ?? "")
        .replace(/\s*\n+\s*/g, " ")
        .trim();
      return line ? `${who}: ${line}` : "";
    })
    .filter(Boolean)
    .join("\n");
  return text || null;
}

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
  * What a disposition knows about the callback it promised.
  *
  * Until this existed, `callback_scheduled` wrote a row with no `due_at` at all,
  * so every promised callback read as "due now" forever and the Callbacks page's
  * overdue/due/upcoming triage sorted nothing.
  */
export interface CallbackDraft {
  /** Floating wall-clock ("2026-06-23T18:00:00"). Absent = no time agreed. */
  iso?: string;
  /** Human label for the agreed time, e.g. "Tue, Jun 23 · 6:00 PM". */
  when?: string;
  reason?: string;
}

/** What a disposition knows about the appointment it booked. */
export interface AppointmentDraft {
  /** Human label — "Tomorrow — Tue, Jun 23 at 6:00 PM", or the AI's own words. */
  when: string;
  /** Floating wall-clock ("2026-06-23T18:00:00"). Absent = booked with no time. */
  iso?: string;
  notes: string;
  durationMin?: number;
  location?: string;
}

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
    appointment?: AppointmentDraft | null;
    callback?: CallbackDraft | null;
    source: "ai" | "rep";
    /** The call this disposition came from — links the appointment to its call. */
    callRecordId?: string | null;
    /** Which AI persona closed it ("primary"/"secondary"); null for rep bookings. */
    agentKey?: string | null;
  },
): Promise<void> {
  const { ownerId, leadId, outcome } = input;

  // Timeline audit: every disposition path funnels through here, so this one
  // fire-and-forget line gives the Lead 360 a status entry for each call filed.
  // The org is resolved inside logLeadEvent (this function doesn't know it).
  if (leadId) {
    logLeadEvent({
      leadId,
      actorId: ownerId,
      kind: "status",
      payload: {
        outcome,
        to: OUTCOME_TO_STATUS[outcome] ?? "contacted",
        from: "disposition",
      },
    });
  }

  // Clear this lead's pending pipeline items so the newest disposition wins.
  if (leadId) {
    await client.from("callbacks").delete().eq("lead_id", leadId).neq("status", "completed");
    // CANCEL, don't delete. Appointments are calendar objects now: a rep who
    // re-dispositions a lead should see the old review struck through on Tuesday,
    // not find that Tuesday silently rewrote itself. It also gives the outbox a
    // cancellation to send, so nobody drives to a review that's been called off.
    // (Reports must not count these — see appointmentsBooked in db/metrics.ts.)
    await client
      .from("appointments")
      .update({
        status: "cancelled",
        cancel_reason: `Re-dispositioned as ${outcome.replace(/_/g, " ")}`,
      })
      .eq("lead_id", leadId)
      .eq("status", "scheduled");
  }

  // Tie the appointment insert to the DISPOSITION only. The old `|| input.appointment`
  // fallback would file an appointment row for a non-booking outcome (e.g. a
  // do_not_call call that still carried a stray appointment object), putting a
  // scheduled review on the calendar for a homeowner who declined or asked to
  // never be called. We deliberately DON'T also require a resolved time here:
  // legitimate bookings with no parsed clock time (manual rep bookings, or a
  // model/agent-confirmed booking the resolver couldn't timestamp) are supported
  // and land, time-less, in the "later" bucket for review.
  if (outcome === "appointment_booked") {
    await client.from("appointments").insert({
      owner_id: ownerId,
      lead_id: leadId,
      lead_name: input.leadName,
      call_record_id: input.callRecordId || null,
      // Machine timestamp (drives the calendar + time buckets) when the resolver
      // pinned a concrete slot; the human label is always kept for display.
      scheduled_at: input.appointment?.iso || null,
      scheduled_label: input.appointment?.when ?? "",
      duration_min: input.appointment?.durationMin || 60,
      location: input.appointment?.location ?? "",
      notes: input.appointment?.notes ?? input.summary ?? "",
      source: input.source,
      // Which AI agent closed it (Agent 1 / Agent 2), so the calendar can be split
      // by agent. Null for rep-booked reviews.
      agent_key: input.source === "ai" ? input.agentKey ?? null : null,
      status: "scheduled",
      // AI bookings are proposals pending human approval; rep-created are final.
      approved: input.source !== "ai",
    });
  } else if (outcome === "callback_scheduled") {
    const cb = input.callback ?? null;
    // Provenance for the Callbacks board: which call the promise was made on
    // (the "View call" link), which campaign the lead was being worked under,
    // and the contact's timezone so the due time can be labeled honestly.
    let cbCampaignId: string | null = null;
    let cbTimezone: string | null = null;
    if (leadId) {
      const { data: l } = await client
        .from("leads")
        .select("campaign_id, timezone")
        .eq("id", leadId)
        .maybeSingle();
      cbCampaignId = l?.campaign_id ? String(l.campaign_id) : null;
      cbTimezone = l?.timezone ? String(l.timezone) : null;
    }
    await client.from("callbacks").insert({
      owner_id: ownerId,
      lead_id: leadId,
      lead_name: input.leadName,
      phone: input.phone,
      call_record_id: input.callRecordId || null,
      campaign_id: cbCampaignId,
      timezone: cbTimezone,
      // The rep's own words about the callback beat a generic summary; the
      // agreed time is appended so the reason still reads correctly on a board
      // that only shows a relative "in 3 hours".
      reason:
        [cb?.reason?.trim() || input.summary || "Callback requested", cb?.when]
          .filter(Boolean)
          .join(" · "),
      // Null when no time was agreed — the honest representation, and what the
      // Callbacks page already renders as "due now".
      due_at: cb?.iso || null,
      status: "due",
    });
  } else if (outcome === "do_not_call") {
    // Suppress the NUMBER, not just this lead row: setting the row's status to
    // do_not_call only stops THIS row, so the same homeowner on a re-import or a
    // second campaign's row was fully dialable. Write the number to the org's
    // suppression list so every dial path scrubs it forever, even if this lead
    // row is later deleted. Resolve the org from the lead (the passed client is
    // RLS-scoped for a rep, admin for the AI path — both can read the row's org).
    let dncOrg: string | null = null;
    if (leadId) {
      const { data } = await client
        .from("leads")
        .select("org_id")
        .eq("id", leadId)
        .maybeSingle();
      dncOrg = data?.org_id ? String(data.org_id) : null;
    }
    if (dncOrg && input.phone) {
      await addToDnc({
        orgId: dncOrg,
        phone: input.phone,
        reason: input.summary || "Marked do not call on a call",
        source: input.source === "ai" ? "ai_disposition" : "rep_disposition",
        createdBy: ownerId,
      });
    }
  }
}

// ── Human call dispositions ──────────────────────────────────────────────────
export async function insertCallRecord(input: {
  leadId?: string | null;
  leadName?: string;
  phone?: string;
  durationSec?: number;
  outcome?: CallOutcome;
  /**
   * The disposition-def key the rep actually PRESSED — already validated by the
   * caller against the org's resolved taxonomy (see /api/calls). For the nine
   * system rows it equals `outcome`; for admin-created buttons it's their
   * `x_*` key. Stored on call_records.disposition; `outcome` stays canonical
   * so historical queries and routeDisposition never change.
   */
  dispositionKey?: string | null;
  channel?: "human" | "ai";
  summary?: string;
  callSid?: string | null;
  /** Conference room (`hc-<id>`) for manual calls — links the recording. */
  room?: string | null;
  /** Rep's free-text call notes — persisted back to leads.notes. */
  notes?: string;
  /**
   * The slot the rep agreed with the homeowner, captured by the booking dialog
   * before the disposition is filed. Optional: a rep who skips it still books the
   * appointment, it just lands with no time (exactly the old behavior) and shows
   * up in the "later" bucket rather than on the calendar.
   */
  appointment?: AppointmentDraft | null;
  /** The callback time the rep agreed, captured before the disposition is filed. */
  callback?: CallbackDraft | null;
  /** Which campaign script (A/B) was shown on this call — null when none was. */
  scriptVariant?: "a" | "b" | null;
  /**
   * Client-minted idempotency key — the SAME value on every outbox replay of
   * this disposition. With `room`, one of the unique keys that makes a replayed
   * save a no-op instead of a duplicate record + duplicate appointment.
   */
  clientAttemptId?: string | null;
  /**
   * The conference room for ATTEMPT RESOLUTION ONLY (parallel non-winner
   * records share the round's room but must not STORE it — call_records.room
   * is unique per round and belongs to the rep-dispositioned record).
   */
  attemptRoom?: string | null;
  /**
   * The callback this dial was launched from (the board's claim→dial deep
   * link). Filing ANY outcome closes that callback's loop — see the
   * completeCallbackForLead call below for the one exception.
   */
  callbackId?: string | null;
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
    // slice performance per campaign. org_id rides the same read — it's where
    // the leaderboard.delta broadcast below goes.
    let campaignId: string | null = null;
    let orgId: string | null = null;
    if (leadUuid) {
      const { data: l } = await supabase
        .from("leads")
        .select("campaign_id, org_id")
        .eq("id", leadUuid)
        .maybeSingle();
      campaignId = (l?.campaign_id as string) ?? null;
      orgId = (l?.org_id as string) ?? null;
    }

    const { data: rec, error: insErr } = await supabase.from("call_records").insert({
      owner_id: user.id,
      lead_id: leadUuid,
      lead_name: input.leadName ?? "",
      phone: input.phone ?? "",
      duration_sec: input.durationSec ?? 0,
      outcome: input.outcome ?? null,
      // The pressed button. Falls back to the outcome itself (every canonical
      // outcome IS a valid system key) so pre-taxonomy clients and outbox
      // replays keep the column populated uniformly.
      disposition: input.dispositionKey ?? input.outcome ?? null,
      channel: input.channel ?? "human",
      summary: input.summary ?? null,
      call_sid: input.callSid ?? null,
      room: input.room ?? null,
      campaign_id: campaignId,
      script_variant: input.scriptVariant ?? null,
      client_attempt_id: input.clientAttemptId ?? null,
      // The rep's notes belong to THIS call. They are also mirrored onto the
      // lead below (that's the lead's current note), but leads.notes is a single
      // field every later call overwrites — so without this column the note from
      // a call was gone the moment the next one was dispositioned.
      notes: input.notes?.trim() || null,
    }).select("id").maybeSingle();

    // 23505 — this exact disposition already landed (the client outbox replayed
    // a save whose response was lost). Return the EXISTING row and skip the
    // lead update + routeDisposition below: the first write already did them,
    // and re-routing is precisely what used to create the duplicate
    // appointment/callback.
    if (insErr?.code === "23505") {
      let dupQuery = supabase.from("call_records").select("id");
      if (input.clientAttemptId) {
        dupQuery = dupQuery.eq("client_attempt_id", input.clientAttemptId);
      } else if (input.room) {
        dupQuery = dupQuery.eq("room", input.room);
      } else {
        return null;
      }
      const { data: dup } = await dupQuery.maybeSingle();
      return (dup as { id?: string } | null)?.id ?? null;
    }
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

    // Claim Twilio's verdict on the call the same way — it lands before this row
    // exists for the same reason the recording does (the rep was still wrapping
    // up when Twilio reported the call completed).
    if (recordId && input.room && isAdminConfigured()) {
      try {
        const admin = createAdminClient();
        const { data: parked } = await admin
          .from("pending_call_verdicts")
          .select("twilio_call_status,twilio_error_code,answered_by")
          .eq("room", input.room)
          .maybeSingle();
        if (parked) {
          await admin.from("call_records").update(parked).eq("id", recordId);
          await admin.from("pending_call_verdicts").delete().eq("room", input.room);
        }
      } catch {
        /* best-effort */
      }
    }

    if (!input.outcome) return recordId ?? null;

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
    // Reservation engine: the OUTCOME WRITE is the server-side release. It
    // stamps the attempt counter + last_attempt_at and clears the dial hold in
    // one statement, so the client never releases after a disposition (a
    // client release racing this could hand the lead to another rep before its
    // counter advanced). This used to run only on the cron path — a rep's
    // filed disposition left the hold to expire on its 180s TTL instead.
    // cooldown 0 = no re-dial gate; the counter + hold release are the point.
    if (leadUuid && orgId) {
      await markLeadAttempted(orgId, leadUuid, { cooldownMinutes: 0 });
    }
    // Close the loop on a callback-launched call — and do it BEFORE
    // routeDisposition, whose "latest disposition wins" cleanup DELETES the
    // lead's open callbacks (`delete … neq status completed`). Run after it and
    // there is nothing left to complete: the promise vanishes with no history,
    // no attempt count, no "recently completed" row. Completing first flips the
    // row to 'completed', which that delete deliberately spares.
    //
    // The one EXCEPTION is callback_scheduled: routeDisposition already
    // replaces open callbacks itself (delete-then-insert of the NEW promise),
    // so completing here too would double-handle the row — the fresh callback
    // simply supersedes the old one.
    const callbackUuid = asUuid(input.callbackId);
    if (callbackUuid && input.outcome !== "callback_scheduled") {
      await completeCallbackForLead(leadUuid, recordId, callbackUuid);
    }
    await routeDisposition(supabase, {
      ownerId: user.id,
      leadId: leadUuid,
      leadName: input.leadName ?? "",
      phone: input.phone ?? "",
      outcome: input.outcome,
      summary: input.summary,
      appointment: input.appointment ?? null,
      callback: input.callback ?? null,
      callRecordId: recordId,
      source: input.channel === "ai" ? "ai" : "rep",
    });

    // Floor broadcast: this rep's numbers just changed. Ad-hoc manual dials have
    // no lead row, so fall back to the rep's own profile for the org. The event
    // carries no math — consumers refetch the leaderboard/floor endpoints.
    if (!orgId) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .maybeSingle();
      orgId = (prof?.org_id as string) ?? null;
    }
    publishOrgEvent(orgId, "leaderboard.delta", { ownerId: user.id });

    // Canonical machine: mark the attempt dispositioned + link the projection
    // row. Resolution: client key, else (room, lead) — attemptRoom covers the
    // parallel non-winner records that must not STORE the shared room.
    const resolveRoom = input.attemptRoom ?? input.room ?? null;
    if (input.clientAttemptId || resolveRoom) {
      const filed = await recordDispositionFiled({
        attemptRef: {
          clientAttemptId: input.clientAttemptId ?? null,
          room: resolveRoom,
          leadId: leadUuid,
        },
        disposition: input.outcome,
        callRecordId: recordId,
        actor: input.channel === "ai" ? "ai" : "rep",
      });
      if (filed.attemptId && recordId && isAdminConfigured()) {
        try {
          await createAdminClient()
            .from("call_records")
            .update({ attempt_id: filed.attemptId })
            .eq("id", recordId);
        } catch {
          /* best-effort */
        }
      }
    }
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

// ── AI conversation: seed at call placement ──────────────────────────────────
// Interactive calls carry a rep session; the unattended cron does NOT. The old
// code bailed when there was no session (`if (!user) return`), so EVERY
// cron-placed AI call went unrecorded: no ai_conversations row, so the Twilio
// status webhook found no ref and never hung up a no-answer (the agent monologued
// to an empty conference on full credits), the reconciler couldn't see it, and
// completeAIConversation returned early — yet the lead was already stamped
// contacted, so it was burned with no disposition. Now the owner is resolved
// session-first (rep attribution preserved) then falls back to an explicit
// ownerId (the org owner for cron), and the row is written with the admin client
// so it's created either way. owner_id is nullable, so even an owner-less org's
// call is still recorded — enough for the no-answer hangup + reconciler to work.
export async function seedAIConversation(input: {
  conversationId: string;
  callSid: string | null;
  leadId: string | null;
  leadName: string;
  phone: string;
  /** The homeowner's Twilio leg (bridge mode) — how the status webhook finds us. */
  customerCallSid?: string | null;
  /** Which override fields actually went out — forensics for a killed call. */
  overrideMode?: string;
  /** Which AI persona placed this call ("primary" = Agent 1, "secondary" = Agent 2).
   *  Carried onto the conversation so the appointment it books can be attributed
   *  to the agent that closed it. */
  agentKey?: string | null;
  /** Fallback owner when there's no rep session (the org owner, for cron). */
  ownerId?: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return;
  try {
    // Prefer the signed-in rep (interactive path); fall back to the provided
    // owner (cron). createClient()/getUser() returns a null user with no cookies
    // rather than throwing, so this is safe from the session-less cron.
    let ownerId = input.ownerId ?? null;
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) ownerId = user.id;
    } catch {
      /* no session (cron) — keep the provided owner */
    }

    const admin = createAdminClient();
    await admin.from("ai_conversations").upsert({
      conversation_id: input.conversationId,
      owner_id: ownerId,
      lead_id: asUuid(input.leadId),
      lead_name: input.leadName,
      phone: input.phone,
      call_sid: input.callSid,
      customer_call_sid: input.customerCallSid ?? null,
      override_mode: input.overrideMode ?? null,
      agent_key: input.agentKey ?? null,
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
      .in("state", LIVE_STATES as unknown as string[])
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
      .in("state", LIVE_STATES as unknown as string[]);
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
  /** The callback time resolved from the transcript, when one was agreed. */
  callback?: CallbackDraft | null;
  /** "failed" for calls that never connected; defaults to "completed". */
  state?: "completed" | "failed";
  /**
   * The call's turn array, persisted with the conversation so the dashboard
   * stops re-fetching ended calls from the ElevenLabs API and other AI
   * surfaces can see what was actually said. Omitted/empty leaves any
   * previously stored transcript untouched.
   */
  transcript?: { role: string; message: string; secs: number | null }[] | null;
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("ai_conversations")
      .select("owner_id, org_id, lead_id, lead_name, phone, call_sid, state, outcome, started_at, agent_key")
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
        ...(input.transcript && input.transcript.length
          ? { transcript: input.transcript }
          : {}),
      })
      .eq("conversation_id", input.conversationId);

    const transcriptText = flattenTranscript(input.transcript);

    const ownerId = existing?.owner_id as string | undefined;
    if (!ownerId) return;

    // Only create the call record if one doesn't already exist for this convo.
    const { data: existingRec } = await admin
      .from("call_records")
      .select("id")
      .eq("conversation_id", input.conversationId)
      .maybeSingle();

    let recordId: string | null = (existingRec as { id?: string } | null)?.id ?? null;
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
      const { data: insRec, error: insErr } = await admin.from("call_records").insert({
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
        // The AI files canonical outcomes only, so the pressed-key column
        // mirrors the outcome — keeps `disposition` uniformly populated across
        // channels for the archive and per-key reporting.
        disposition: input.outcome,
        failure_kind: input.failureKind ?? null,
        termination_reason: input.terminationReason ?? null,
        channel: "ai",
        conversation_id: input.conversationId,
        summary: input.summary,
        sentiment: input.sentiment,
        campaign_id: campaignId,
        transcript_text: flattenTranscript(input.transcript),
      }).select("id").maybeSingle();
      recordId = (insRec as { id?: string } | null)?.id ?? null;
      // 23505: a concurrent finalize (webhook racing the reconciler) inserted
      // between our existence check and this insert — the unique
      // conversation_id index closed that race. The other writer carried the
      // same payload; adopt its row instead of duplicating.
      if (insErr?.code === "23505") {
        const { data: winner } = await admin
          .from("call_records")
          .select("id")
          .eq("conversation_id", input.conversationId)
          .maybeSingle();
        recordId = (winner as { id?: string } | null)?.id ?? null;
      }
    } else if (upgrading) {
      // Correct the previously-filed (e.g. no-answer) record with the real result.
      await admin
        .from("call_records")
        .update({
          outcome: input.outcome,
          disposition: input.outcome,
          failure_kind: input.failureKind ?? null,
          termination_reason: input.terminationReason ?? null,
          summary: input.summary,
          sentiment: input.sentiment,
          duration_sec: input.durationSec ?? 0,
          // The upgrade path is exactly the case where the transcript arrives
          // LATE (a call filed as no-answer, corrected by the post-call webhook
          // that carries the turns) — so this is the one that must not skip it.
          ...(transcriptText ? { transcript_text: transcriptText } : {}),
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
      callback: input.callback ?? null,
      source: "ai",
      agentKey: (existing?.agent_key as string) ?? null,
    });

    // Floor broadcast: an AI outcome just landed on this owner's numbers.
    publishOrgEvent(
      existing?.org_id ? String(existing.org_id) : null,
      "leaderboard.delta",
      { ownerId },
    );

    // Canonical machine: mark the attempt dispositioned + link the projection.
    const filed = await recordDispositionFiled({
      attemptRef: { conversationId: input.conversationId },
      disposition: input.outcome,
      callRecordId: recordId,
      actor: "ai",
    });
    if (filed.attemptId && recordId) {
      try {
        await admin
          .from("call_records")
          .update({ attempt_id: filed.attemptId })
          .eq("id", recordId);
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Advance a conversation to "ringing" — the homeowner's phone is now audibly
 * ringing, per Twilio. Only from "initiated": a late `ringing` webhook must never
 * drag a call that already connected backwards. Twilio does not guarantee
 * callback ordering, so this guard is load-bearing, not decorative.
 */
export async function markAIConversationRinging(
  conversationId: string,
): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    await createAdminClient()
      .from("ai_conversations")
      .update({ state: "ringing", ringing_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("state", "initiated");
  } catch {
    /* best-effort */
  }
}

/**
 * Advance a conversation to "in_progress" the moment the HOMEOWNER picks up.
 *
 * The guard admits "ringing" as well as "initiated". That is not a cosmetic
 * widening: with a `ringing` state in the lifecycle, an `.eq("state","initiated")`
 * guard would reject every real connect that had (correctly) passed through
 * ringing first, and the call would be pinned at "Ringing" for its entire
 * duration. Terminal rows are still never resurrected.
 *
 * `connected_at` is only stamped if it is null, so a duplicate/retried webhook
 * can't reset the on-call timer to zero mid-conversation.
 */
export async function markAIConversationActive(
  conversationId: string,
): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("ai_conversations")
      .select("connected_at")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    await admin
      .from("ai_conversations")
      .update({
        state: "in_progress",
        ...(data?.connected_at ? {} : { connected_at: new Date().toISOString() }),
      })
      .eq("conversation_id", conversationId)
      .in("state", ["initiated", "ringing"]);
  } catch {
    /* best-effort */
  }
}

/**
 * Claim the right to close out a call that Twilio says never connected (no-answer
 * / busy / failed / canceled). Returns true exactly once, and only if the call
 * has NOT already reached "in_progress".
 *
 * This is the mutex the status webhook uses before it hangs up the AI agent's
 * leg. Lose the swap and someone already advanced the call to in_progress — the
 * homeowner IS on the line — so we must not hang up on them.
 *
 * Note what this deliberately does NOT do: set the state to a terminal value.
 * It stakes its claim on `termination_reason` instead. Writing state='failed'
 * here would be self-defeating — completeAIConversation() treats an already-
 * terminal row as final and returns without writing anything, so the call would
 * go terminal with NO outcome and no summary, permanently un-dispositioned. The
 * claim reserves the call; finalizeAIConversation() is what actually files it.
 *
 * If we crash between the two, the row is still in a live state with a
 * termination_reason set, so the cron reconciler will find it and finish the job.
 */
export async function claimAIConversationUnanswered(
  conversationId: string,
  reason: string,
): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  try {
    const { data } = await createAdminClient()
      .from("ai_conversations")
      .update({ termination_reason: reason || "no-answer" })
      .eq("conversation_id", conversationId)
      .in("state", ["initiated", "ringing"])
      .is("termination_reason", null)
      .select("conversation_id");
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Everything the Twilio status webhook needs to act on a conversation. */
export interface AICallRef {
  conversationId: string;
  /** The ElevenLabs agent's Twilio leg — the one we hang up on a no-answer. */
  callSid: string | null;
  state: string;
  connectedAt: number | null;
}

/**
 * Resolve a conversation from the homeowner's Twilio leg SID. The status webhook
 * carries a CallSid and nothing else if its query string is ever lost, so this is
 * the fallback that keeps the event from being silently dropped.
 */
export async function getAICallRefByCustomerSid(
  customerCallSid: string,
): Promise<AICallRef | null> {
  if (!isAdminConfigured() || !customerCallSid) return null;
  try {
    const { data } = await createAdminClient()
      .from("ai_conversations")
      .select("conversation_id, call_sid, state, connected_at")
      .eq("customer_call_sid", customerCallSid)
      .maybeSingle();
    if (!data) return null;
    return {
      conversationId: String(data.conversation_id),
      callSid: (data.call_sid as string) ?? null,
      state: String(data.state ?? "initiated"),
      connectedAt: data.connected_at ? Date.parse(String(data.connected_at)) : null,
    };
  } catch {
    return null;
  }
}

/** An active call's Twilio legs, for the direct-mode status poller. */
export interface AILegRef {
  conversationId: string;
  /** The leg ElevenLabs placed. In DIRECT mode this IS the homeowner's leg. */
  callSid: string | null;
  /** The leg WE placed to the homeowner (bridge mode only). */
  customerCallSid: string | null;
  state: string;
  startedAt: number;
}

/**
 * The Twilio legs of calls that haven't connected yet — the ones whose true state
 * we may still be missing. Used by the direct-mode poller, which asks Twilio
 * directly because it cannot attach a status callback to a leg ElevenLabs created.
 */
export async function listUnconnectedAILegs(
  conversationIds: string[],
): Promise<AILegRef[]> {
  if (!isAdminConfigured() || conversationIds.length === 0) return [];
  try {
    const { data } = await createAdminClient()
      .from("ai_conversations")
      .select("conversation_id, call_sid, customer_call_sid, state, started_at")
      .in("conversation_id", conversationIds.slice(0, 200))
      .in("state", ["initiated", "ringing"]);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      conversationId: String(r.conversation_id),
      callSid: (r.call_sid as string) ?? null,
      customerCallSid: (r.customer_call_sid as string) ?? null,
      state: String(r.state ?? "initiated"),
      startedAt: r.started_at ? Date.parse(String(r.started_at)) : Date.now(),
    }));
  } catch {
    return [];
  }
}

/** Same, by conversation id. */
export async function getAICallRef(
  conversationId: string,
): Promise<AICallRef | null> {
  if (!isAdminConfigured() || !conversationId) return null;
  try {
    const { data } = await createAdminClient()
      .from("ai_conversations")
      .select("conversation_id, call_sid, state, connected_at")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (!data) return null;
    return {
      conversationId: String(data.conversation_id),
      callSid: (data.call_sid as string) ?? null,
      state: String(data.state ?? "initiated"),
      connectedAt: data.connected_at ? Date.parse(String(data.connected_at)) : null,
    };
  } catch {
    return null;
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
  /** They picked up. The live timer counts from here, not startedAt. */
  connectedAt: number | null;
  appointment: { when: string; notes: string } | null;
  /** Stored turn array (null for calls finalized before persistence landed). */
  transcript: { role: string; message: string; secs: number | null }[] | null;
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
      connectedAt: data.connected_at
        ? Date.parse(String(data.connected_at))
        : null,
      appointment:
        (data.appointment as { when: string; notes: string } | null) ?? null,
      transcript: Array.isArray(data.transcript)
        ? (data.transcript as { role: string; message: string; secs: number | null }[])
        : null,
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
    /** The disposition-def key chosen, when the override UI offered the org's
     *  taxonomy. Defaults to the canonical outcome (a valid system key). */
    dispositionKey?: string | null;
    actorLabel?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { lead, outcome } = input;
    const disposition = input.dispositionKey ?? outcome;
    // A nameless lead falls back to the number, which is at least actionable —
    // this used to stamp the literal word "Homeowner" onto the call record and
    // the calendar entry, in every vertical.
    const leadName =
      `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() ||
      (lead.phone ?? "").trim();
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
      // The override replaces BOTH facts: the canonical outcome and the pressed
      // key — leaving the old key would disagree with the corrected outcome.
      await admin.from("call_records").update({ outcome, disposition }).eq("id", rec.id);
    } else {
      await admin.from("call_records").insert({
        owner_id: lead.owner_id,
        lead_id: lead.id,
        lead_name: leadName,
        outcome,
        disposition,
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
  /** The disposition-def key chosen, when the override UI offered the org's
   *  taxonomy. Defaults to the canonical outcome (a valid system key). */
  dispositionKey?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured())
    return { ok: false, error: "Connect Supabase to save dispositions." };
  const disposition = dispositionKey ?? outcome;
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
      await supabase
        .from("call_records")
        .update({ outcome, disposition })
        .eq("id", rec.id);
    } else {
      await supabase.from("call_records").insert({
        owner_id: user.id,
        lead_id: convo?.lead_id ?? null,
        lead_name: convo?.lead_name ?? "",
        duration_sec: convo?.duration_sec ?? 0,
        outcome,
        disposition,
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
  state: AILiveState;
  sentiment: "positive" | "neutral" | "negative";
  startedAt: number;
  /** When their phone started ringing. */
  ringingAt?: number;
  /** When they picked up. The on-call timer counts from HERE, not startedAt. */
  connectedAt?: number;
  endedAt?: number;
  durationSec?: number;
  summary?: string;
  outcome?: CallOutcome | null;
  recordingAvailable?: boolean;
}

/** Today's AI-calling totals for the Live Monitor KPI strip. */
export interface AITodayStats {
  /** Real calls placed today (excludes never-connected "not a real call" rows). */
  calls: number;
  /** Homeowners who picked up today. */
  connects: number;
  /** Appointments booked today. */
  booked: number;
  /** Calls that finished today. */
  completed: number;
  /** connects / calls, whole %. */
  connectRate: number;
}

const EMPTY_AI_TODAY: AITodayStats = {
  calls: 0, connects: 0, booked: 0, completed: 0, connectRate: 0,
};

/**
 * Today's AI stats (org tz) for the Live Monitor KPIs. Previously the monitor
 * derived "Recently completed / Connect rate / Appointments" from only the last
 * ≤8 terminal calls, so those tiles were noisy and never reconciled with Reports.
 * This computes them over the whole day via cheap COUNT queries (head-only, no
 * rows transferred), matching the "not a real call" exclusion the schema defines
 * (outcome NULL + failure_kind set ⇒ excluded from the connect-rate denominator).
 */
export async function getAITodayStats(): Promise<AITodayStats> {
  if (!isSupabaseConfigured()) return EMPTY_AI_TODAY;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return EMPTY_AI_TODAY;

    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;
    const supervisor =
      Boolean(orgId) && ["owner", "admin", "manager"].includes(String(prof?.role ?? "rep"));

    const { data: org } = orgId
      ? await supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle()
      : { data: null as { timezone?: string } | null };
    // The ONE timezone fallback (America/Chicago, matching the dialing/TCPA
    // path) — a UTC fallback rolled "today" over at the wrong wall-clock hour.
    const tz = orgTimezone(org);
    const todayStartISO = new Date(zonedDayStartMs(Date.now(), tz)).toISOString();

    // A fresh head-count query per metric, all sharing the same scope + "today".
    const base = () => {
      let q = supabase
        .from("ai_conversations")
        .select("*", { count: "exact", head: true });
      q = supervisor ? q.eq("org_id", orgId as string) : q.eq("owner_id", user.id);
      if (!supervisor && orgId) q = q.eq("org_id", orgId);
      return q.gte("started_at", todayStartISO);
    };

    const [callsTotal, notReal, connects, booked, completed] = await Promise.all([
      base(),
      base().is("outcome", null).not("failure_kind", "is", null),
      // connected_at (stamped once when the callee answers) IS the human-connect evidence for AI calls — glossary: human_connects.
      base().not("connected_at", "is", null),
      base().eq("outcome", "appointment_booked"),
      base().not("ended_at", "is", null),
    ]);

    const calls = Math.max(0, (callsTotal.count ?? 0) - (notReal.count ?? 0));
    const connectCount = connects.count ?? 0;
    return {
      calls,
      connects: connectCount,
      booked: booked.count ?? 0,
      completed: completed.count ?? 0,
      connectRate: calls > 0 ? Math.round((connectCount / calls) * 100) : 0,
    };
  } catch {
    return EMPTY_AI_TODAY;
  }
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

    let base = supabase.from("ai_conversations").select("*");
    // A rep's "own" scope must stay within their CURRENT org — never surface
    // AI conversations they happen to own from an org they've since left.
    base = supervisor ? base.eq("org_id", orgId as string) : base.eq("owner_id", user.id);
    if (!supervisor && orgId) base = base.eq("org_id", orgId);
    const { data, error } = await base
      .order("started_at", { ascending: false })
      .limit(supervisor ? 100 : 50);
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
        ringingAt: r.ringing_at ? Date.parse(String(r.ringing_at)) : undefined,
        connectedAt: r.connected_at ? Date.parse(String(r.connected_at)) : undefined,
        endedAt: r.ended_at ? Date.parse(String(r.ended_at)) : undefined,
        durationSec: r.duration_sec == null ? undefined : Number(r.duration_sec),
        summary: (r.summary as string) ?? undefined,
        outcome: (r.outcome as CallOutcome) ?? null,
        recordingAvailable: state === "completed",
      };
    };

    const all = (data ?? []).map(map);
    return {
      active: all.filter((c) => LIVE_STATES.includes(c.state)),
      recent: all.filter((c) => isTerminalLiveState(c.state)).slice(0, 8),
    };
  } catch {
    return { active: [], recent: [] };
  }
}
