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
}): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("ai_conversations")
      .select("owner_id, lead_id, lead_name")
      .eq("conversation_id", input.conversationId)
      .maybeSingle();

    await admin
      .from("ai_conversations")
      .update({
        state: "completed",
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
