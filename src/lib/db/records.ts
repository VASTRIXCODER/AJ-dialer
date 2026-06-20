import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { CallOutcome } from "../types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v?: string | null) => (v && UUID.test(v) ? v : null);

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
      .select("owner_id, lead_id, lead_name, state")
      .eq("conversation_id", input.conversationId)
      .maybeSingle();

    // Idempotent: if this conversation is already finalized, do nothing. This
    // makes it safe to call from both the post-call webhook and the live detail
    // route without duplicating call records or appointments.
    const prevState = existing?.state as string | undefined;
    if (prevState === "completed" || prevState === "failed") return;

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
    }

    if (input.appointment) {
      await admin.from("appointments").insert({
        owner_id: ownerId,
        lead_id: existing?.lead_id ?? null,
        lead_name: existing?.lead_name ?? "",
        scheduled_label: input.appointment.when,
        notes: input.appointment.notes,
        source: "ai",
        status: "scheduled",
      });
    }
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
      .select("lead_id, lead_name, duration_sec")
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
