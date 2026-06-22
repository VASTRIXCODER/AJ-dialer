import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { CallOutcome } from "../types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v?: string | null) => (v && UUID.test(v) ? v : null);

// Outcomes that mean a real two-way conversation took place (vs. no-answer /
// voicemail / wrong-number). Used to decide when a later, better disposition is
// allowed to upgrade an earlier "didn't connect" one.
const CONNECTED_OUTCOMES: CallOutcome[] = [
  "appointment_booked",
  "callback_scheduled",
  "qualified",
  "not_interested",
  "do_not_call",
];

// outcome → lead status (shared by every disposition path).
const OUTCOME_TO_STATUS: Record<CallOutcome, string> = {
  appointment_booked: "appointment",
  callback_scheduled: "callback",
  qualified: "qualified",
  not_interested: "not_interested",
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
    appointment?: { when: string; notes: string } | null;
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
      scheduled_label: input.appointment?.when ?? "",
      notes: input.appointment?.notes ?? input.summary ?? "",
      source: input.source,
      status: "scheduled",
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
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("call_records").insert({
      owner_id: user.id,
      lead_id: asUuid(input.leadId),
      lead_name: input.leadName ?? "",
      phone: input.phone ?? "",
      duration_sec: input.durationSec ?? 0,
      outcome: input.outcome ?? null,
      channel: input.channel ?? "human",
      summary: input.summary ?? null,
    });

    if (!input.outcome) return;

    // Reflect the disposition on the lead + route it to the right pipeline tab.
    const leadUuid = asUuid(input.leadId);
    if (leadUuid) {
      await supabase
        .from("leads")
        .update({
          status: OUTCOME_TO_STATUS[input.outcome] ?? "contacted",
          last_contacted_at: new Date().toISOString(),
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
  } catch {
    /* best-effort */
  }
}

// ── AI conversation: seed at call placement (user session present) ───────────
export async function seedAIConversation(input: {
  conversationId: string;
  callSid: string | null;
  leadId: string | null;
  leadName: string;
  phone: string;
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
      state: "initiated",
    });
  } catch {
    /* best-effort */
  }
}

// ── AI conversation: complete from the webhook (no session → admin client) ───
export async function completeAIConversation(input: {
  conversationId: string;
  summary: string;
  outcome: CallOutcome;
  sentiment: string;
  durationSec?: number;
  appointment?: { when: string; notes: string } | null;
  /** "failed" for calls that never connected; defaults to "completed". */
  state?: "completed" | "failed";
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("ai_conversations")
      .select("owner_id, lead_id, lead_name, phone, state, outcome")
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
      CONNECTED_OUTCOMES.includes(prevOutcome);
    const newConnected =
      input.state !== "failed" && CONNECTED_OUTCOMES.includes(input.outcome);
    if (isFinal && !(newConnected && !prevConnected)) return;
    const upgrading = isFinal;

    await admin
      .from("ai_conversations")
      .update({
        state: input.state ?? "completed",
        summary: input.summary,
        outcome: input.outcome,
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
      await admin.from("call_records").insert({
        owner_id: ownerId,
        lead_id: existing?.lead_id ?? null,
        lead_name: existing?.lead_name ?? "",
        duration_sec: input.durationSec ?? 0,
        outcome: input.outcome,
        channel: "ai",
        conversation_id: input.conversationId,
        summary: input.summary,
        sentiment: input.sentiment,
      });
    } else if (upgrading) {
      // Correct the previously-filed (e.g. no-answer) record with the real result.
      await admin
        .from("call_records")
        .update({
          outcome: input.outcome,
          summary: input.summary,
          sentiment: input.sentiment,
          duration_sec: input.durationSec ?? 0,
        })
        .eq("id", existingRec.id);
    }

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

// ── Manual disposition override (from the monitor mini-dashboard) ─────────────
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
    const { data } = await supabase
      .from("ai_conversations")
      .select("*")
      .eq("owner_id", user.id)
      .order("started_at", { ascending: false })
      .limit(50);

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
