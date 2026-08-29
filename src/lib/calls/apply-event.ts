import "server-only";

import {
  type AttemptState,
  type CallEventType,
  decideTransition,
  isTransportTerminal,
  twilioStatusToState,
} from "@/lib/calls/state-machine";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { count } from "@/lib/telemetry";

// ─────────────────────────────────────────────────────────────────────────────
// THE one write path for call lifecycle. Every provider callback, dial request,
// wrap-up, and reconciliation passes through applyCallEvent():
//
//   1. append the immutable call_events row (idempotent — a duplicate provider
//      event dies on the unique fingerprint and NOTHING else runs);
//   2. resolve (or create) the business-level call_attempts row;
//   3. upsert the provider leg;
//   4. CAS the attempt's canonical state per the pure transition table in
//      state-machine.ts — late/duplicate/out-of-order events lose the CAS and
//      are reported, never thrown.
//
// call_records stays the reporting projection (dual-write phase); these tables
// are the source of truth. Best-effort like every webhook helper in this repo:
// catches, logs to telemetry, never throws into a webhook path.
// ─────────────────────────────────────────────────────────────────────────────

export interface AttemptRef {
  attemptId?: string | null;
  clientAttemptId?: string | null;
  /** hc-<id> conference. A parallel round shares one room across attempts —
   *  pair with leadId to identify THE attempt; alone it matches only when the
   *  room has a single attempt. */
  room?: string | null;
  conversationId?: string | null;
  leadId?: string | null;
  orgId?: string | null;
}

export interface IncomingCallEvent {
  source: "twilio" | "elevenlabs" | "app" | "rep" | "cron";
  type: CallEventType;
  /** Dedupe fingerprint from providerEventFingerprint(); null = app-internal. */
  providerEventId?: string | null;
  /** Provider's own timestamp when carried; defaults to now(). */
  eventTime?: string | null;
  attemptRef: AttemptRef;
  /** When set, an unmatched ref creates the attempt with these facts. */
  create?: {
    orgId: string | null;
    ownerId: string | null;
    leadId: string | null;
    phone: string;
    channel: "human" | "ai";
    dialMode: "manual" | "parallel" | "ai_interactive" | "ai_cron";
    campaignId?: string | null;
    initialState?: AttemptState;
  };
  /** Explicit canonical target; when absent it is derived from leg.rawStatus. */
  targetState?: AttemptState | null;
  leg?: {
    providerSid?: string | null;
    leadId?: string | null;
    role?: "customer" | "rep" | "agent";
    rawStatus?: string | null;
    errorCode?: number | null;
    answeredBy?: string | null;
  };
  payload?: Record<string, unknown>;
}

export interface ApplyResult {
  ok: boolean;
  applied: "applied" | "duplicate" | "stale" | "unmatched" | "recorded_only";
  attemptId: string | null;
  newState?: AttemptState;
}

interface AttemptRow {
  id: string;
  org_id: string | null;
  state: AttemptState;
  transport_outcome: string | null;
  dialing_at: string | null;
  ringing_at: string | null;
  connected_at: string | null;
  ended_at: string | null;
  wrap_started_at: string | null;
  dispositioned_at: string | null;
}

const ATTEMPT_COLS =
  "id, org_id, state, transport_outcome, dialing_at, ringing_at, connected_at, ended_at, wrap_started_at, dispositioned_at";

/** Which fill-once timestamp column a state stamps on entry. */
const STATE_TS: Partial<Record<AttemptState, keyof AttemptRow>> = {
  dialing: "dialing_at",
  ringing: "ringing_at",
  human_connected: "connected_at",
  voicemail_connected: "connected_at",
  busy: "ended_at",
  declined: "ended_at",
  no_answer: "ended_at",
  failed: "ended_at",
  canceled: "ended_at",
  wrap_up: "wrap_started_at",
  dispositioned: "dispositioned_at",
  completed: "ended_at",
};

/** Canonical event type for a raw Twilio CallStatus (leg-level). */
export function twilioEventTypeForStatus(
  callStatus: string,
  answeredBy?: string | null,
): CallEventType | null {
  switch (callStatus) {
    case "initiated":
    case "queued":
      return "leg.initiated";
    case "ringing":
      return "leg.ringing";
    case "in-progress":
    case "answered":
      return answeredBy?.startsWith("machine") ? "leg.machine_detected" : "leg.answered";
    case "busy":
      return "leg.busy";
    case "no-answer":
      return "leg.no_answer";
    case "failed":
      return "leg.failed";
    case "canceled":
      return "leg.canceled";
    case "completed":
      return "leg.completed";
    default:
      return null;
  }
}

type Admin = ReturnType<typeof createAdminClient>;

async function resolveAttempt(admin: Admin, ref: AttemptRef): Promise<AttemptRow | null> {
  if (ref.attemptId) {
    const { data } = await admin
      .from("call_attempts")
      .select(ATTEMPT_COLS)
      .eq("id", ref.attemptId)
      .maybeSingle();
    if (data) return data as unknown as AttemptRow;
  }
  if (ref.clientAttemptId) {
    // Client ids are UUIDs — globally unique in practice; org narrows when known.
    let q = admin
      .from("call_attempts")
      .select(ATTEMPT_COLS)
      .eq("client_attempt_id", ref.clientAttemptId);
    if (ref.orgId) q = q.eq("org_id", ref.orgId);
    const { data } = await q.limit(1).maybeSingle();
    if (data) return data as unknown as AttemptRow;
  }
  if (ref.conversationId) {
    const { data } = await admin
      .from("call_attempts")
      .select(ATTEMPT_COLS)
      .eq("conversation_id", ref.conversationId)
      .maybeSingle();
    if (data) return data as unknown as AttemptRow;
  }
  if (ref.room && ref.leadId) {
    const { data } = await admin
      .from("call_attempts")
      .select(ATTEMPT_COLS)
      .eq("room", ref.room)
      .eq("lead_id", ref.leadId)
      .maybeSingle();
    if (data) return data as unknown as AttemptRow;
  }
  if (ref.room) {
    // A single-line room, or an event with no leadId — take the round's newest.
    const { data } = await admin
      .from("call_attempts")
      .select(ATTEMPT_COLS)
      .eq("room", ref.room)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as unknown as AttemptRow;
  }
  return null;
}

async function createAttempt(
  admin: Admin,
  evt: IncomingCallEvent,
): Promise<AttemptRow | null> {
  const c = evt.create;
  if (!c) return null;
  const state = c.initialState ?? "dialing";
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("call_attempts")
    .insert({
      org_id: c.orgId,
      owner_id: c.ownerId,
      lead_id: c.leadId,
      campaign_id: c.campaignId ?? null,
      channel: c.channel,
      dial_mode: c.dialMode,
      client_attempt_id: evt.attemptRef.clientAttemptId ?? null,
      room: evt.attemptRef.room ?? null,
      conversation_id: evt.attemptRef.conversationId ?? null,
      phone: c.phone,
      state,
      state_changed_at: now,
      ...(state === "dialing" ? { dialing_at: now } : {}),
    })
    .select(ATTEMPT_COLS)
    .maybeSingle();
  if (data) return data as unknown as AttemptRow;
  // 23505 — a concurrent writer created it first (webhook racing the dial
  // response). Fall back to resolving what they wrote.
  if (error?.code === "23505") return resolveAttempt(admin, evt.attemptRef);
  return null;
}

/**
 * The ONE write path for call lifecycle. Events-first: the log row lands before
 * any state logic, so a crash after step 1 is repaired forward by the
 * reconciler rather than lost.
 */
export async function applyCallEvent(evt: IncomingCallEvent): Promise<ApplyResult> {
  if (!isAdminConfigured()) return { ok: false, applied: "unmatched", attemptId: null };
  try {
    const admin = createAdminClient();

    // 2. Resolve or create the attempt FIRST (the event row wants attempt_id;
    //    creation is itself race-safe via the unique keys).
    let attempt = await resolveAttempt(admin, evt.attemptRef);
    if (!attempt && evt.create) attempt = await createAttempt(admin, evt);

    // 1. Append the immutable event. ON CONFLICT DO NOTHING on the fingerprint:
    //    zero rows back ⇒ an exact duplicate ⇒ nothing else runs.
    const eventRow = {
      org_id: attempt?.org_id ?? evt.attemptRef.orgId ?? evt.create?.orgId ?? null,
      attempt_id: attempt?.id ?? null,
      source: evt.source,
      event_type: evt.type,
      provider_event_id: evt.providerEventId ?? null,
      event_time: evt.eventTime ?? new Date().toISOString(),
      payload: evt.payload ?? {},
    };
    if (evt.providerEventId) {
      const { data: inserted } = await admin
        .from("call_events")
        .upsert(eventRow, { ignoreDuplicates: true })
        .select("id");
      if (!inserted || inserted.length === 0) {
        return { ok: true, applied: "duplicate", attemptId: attempt?.id ?? null };
      }
    } else {
      await admin.from("call_events").insert(eventRow);
    }

    if (!attempt) {
      // A call we don't track (pre-Phase-1 dial, or demo row). The event is
      // logged; there is no state to move.
      return { ok: true, applied: "recorded_only", attemptId: null };
    }

    // 3. Upsert the provider leg (read-then-write so answered_at/ended_at fill
    //    exactly once; the unique (provider, provider_sid) key backstops races).
    if (evt.leg?.providerSid) {
      const l = evt.leg;
      const now = new Date().toISOString();
      const raw = l.rawStatus ?? null;
      const answered = raw === "in-progress" || raw === "answered";
      const legEnded =
        raw === "completed" || raw === "busy" || raw === "no-answer" ||
        raw === "failed" || raw === "canceled";
      const { data: existingLeg } = await admin
        .from("call_legs")
        .select("id, answered_at, ended_at, ring_started_at")
        .eq("provider", "twilio")
        .eq("provider_sid", l.providerSid)
        .maybeSingle();
      const legPatch = {
        ...(raw ? { status: raw } : {}),
        ...(l.errorCode != null ? { error_code: l.errorCode } : {}),
        ...(l.answeredBy ? { answered_by: l.answeredBy } : {}),
      };
      if (existingLeg) {
        await admin
          .from("call_legs")
          .update({
            ...legPatch,
            ...(raw === "ringing" && !existingLeg.ring_started_at
              ? { ring_started_at: now }
              : {}),
            ...(answered && !existingLeg.answered_at ? { answered_at: now } : {}),
            ...(legEnded && !existingLeg.ended_at ? { ended_at: now } : {}),
          })
          .eq("id", existingLeg.id);
      } else {
        const { error: legErr } = await admin.from("call_legs").insert({
          attempt_id: attempt.id,
          org_id: attempt.org_id,
          provider: "twilio",
          provider_sid: l.providerSid,
          lead_id: l.leadId ?? null,
          role: l.role ?? "customer",
          ...legPatch,
          ...(raw === "ringing" ? { ring_started_at: now } : {}),
          ...(answered ? { answered_at: now } : {}),
          ...(legEnded ? { ended_at: now } : {}),
        });
        if (legErr && legErr.code !== "23505") {
          count("event.leg_write_fail", 1, { orgId: attempt.org_id });
        }
      }
    }

    // 4. CAS the canonical state.
    const target =
      evt.targetState ??
      (evt.leg?.rawStatus
        ? twilioStatusToState(evt.leg.rawStatus, evt.leg.answeredBy)
        : null);
    if (!target) return { ok: true, applied: "applied", attemptId: attempt.id };

    // attempt.reconciled is the ONE sanctioned corrector: the cron (or a
    // late-truth webhook) force-finishes attempts the provider path missed —
    // a stuck "dialing" whose conversation is long over, or a filed no_answer
    // that the full transcript proves was a real conversation. Its events are
    // logged like everything else; only its transition authority differs.
    if (evt.type === "attempt.reconciled") {
      const now = new Date().toISOString();
      const tsCol = STATE_TS[target];
      const connectedUpgrade =
        (target === "human_connected" || target === "voicemail_connected") &&
        attempt.transport_outcome != null &&
        !["human_connected", "voicemail_connected"].includes(attempt.transport_outcome);
      await admin
        .from("call_attempts")
        .update({
          state: target,
          state_changed_at: now,
          ...(tsCol && !attempt[tsCol] ? { [tsCol]: now } : {}),
          ...(attempt.transport_outcome == null && isTransportTerminal(target)
            ? { transport_outcome: target, terminal_reason: "reconciled" }
            : {}),
          ...(connectedUpgrade ? { transport_outcome: target } : {}),
          ...(attempt.ended_at ? {} : { ended_at: now }),
        })
        .eq("id", attempt.id);
      return { ok: true, applied: "applied", attemptId: attempt.id, newState: target };
    }

    for (let tries = 0; tries < 2; tries++) {
      const decision = decideTransition(attempt.state, target);
      if (!decision.apply) {
        if (decision.reason === "stale") count("event.stale", 1, { orgId: attempt.org_id });
        return {
          ok: true,
          applied: decision.reason === "duplicate" ? "duplicate" : "stale",
          attemptId: attempt.id,
        };
      }

      const now = new Date().toISOString();
      const tsCol = STATE_TS[target];
      const patch: Record<string, unknown> = {
        state: target,
        state_changed_at: now,
      };
      if (tsCol && !attempt[tsCol]) patch[tsCol] = now;
      if (isTransportTerminal(target) && attempt.transport_outcome == null) {
        patch.transport_outcome = target;
        patch.terminal_reason =
          evt.leg?.errorCode != null
            ? `${evt.leg.rawStatus ?? target} (${evt.leg.errorCode})`
            : evt.leg?.rawStatus ?? target;
      }
      const { data: updated } = await admin
        .from("call_attempts")
        .update(patch)
        .eq("id", attempt.id)
        .in("state", decision.allowedFrom)
        .select("id");
      if (updated && updated.length > 0) {
        return { ok: true, applied: "applied", attemptId: attempt.id, newState: target };
      }
      // Lost the CAS to a concurrent writer — re-read once and re-decide.
      const fresh = await resolveAttempt(admin, { attemptId: attempt.id });
      if (!fresh) break;
      attempt = fresh;
    }
    count("event.cas_lost", 1, { orgId: attempt.org_id });
    return { ok: true, applied: "stale", attemptId: attempt.id };
  } catch {
    count("event.apply_fail");
    return { ok: false, applied: "unmatched", attemptId: null };
  }
}

/** Convenience: create the attempt at dial time (state "dialing"). */
export async function recordDialRequested(input: {
  orgId: string | null;
  ownerId: string | null;
  leadId: string | null;
  phone: string;
  channel: "human" | "ai";
  dialMode: "manual" | "parallel" | "ai_interactive" | "ai_cron";
  clientAttemptId?: string | null;
  room?: string | null;
  conversationId?: string | null;
  campaignId?: string | null;
  providerSid?: string | null;
}): Promise<{ attemptId: string | null }> {
  const res = await applyCallEvent({
    source: "app",
    type: "dial.requested",
    attemptRef: {
      clientAttemptId: input.clientAttemptId ?? null,
      room: input.room ?? null,
      conversationId: input.conversationId ?? null,
      leadId: input.leadId ?? null,
      orgId: input.orgId,
    },
    create: {
      orgId: input.orgId,
      ownerId: input.ownerId,
      leadId: input.leadId,
      phone: input.phone,
      channel: input.channel,
      dialMode: input.dialMode,
      campaignId: input.campaignId ?? null,
    },
    leg: input.providerSid
      ? { providerSid: input.providerSid, leadId: input.leadId, rawStatus: null }
      : undefined,
    payload: { phone: input.phone },
  });
  return { attemptId: res.attemptId };
}

/** Convenience: the business disposition was filed (wrap-up / AI / review). */
export async function recordDispositionFiled(input: {
  attemptRef: AttemptRef;
  disposition: string;
  callRecordId: string | null;
  actor: "rep" | "ai" | "cron";
}): Promise<ApplyResult> {
  const res = await applyCallEvent({
    source: input.actor === "ai" ? "elevenlabs" : input.actor === "cron" ? "cron" : "rep",
    type: "disposition.filed",
    attemptRef: input.attemptRef,
    targetState: "dispositioned",
    payload: { disposition: input.disposition },
  });
  if (res.attemptId && isAdminConfigured()) {
    try {
      await createAdminClient()
        .from("call_attempts")
        .update({
          disposition: input.disposition,
          ...(input.callRecordId ? { call_record_id: input.callRecordId } : {}),
        })
        .eq("id", res.attemptId);
    } catch {
      /* best-effort */
    }
  }
  return res;
}
