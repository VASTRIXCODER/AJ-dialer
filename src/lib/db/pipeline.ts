import "server-only";

import { reconcileOwnerActiveCalls } from "../ai-call-reconcile";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";

// Account-scoped reads/writes for the pipeline surfaces. Each returns empty (or
// a graceful error) in demo mode instead of throwing.

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

// ── Campaigns ────────────────────────────────────────────────────────────────
export interface CampaignRow {
  id: string;
  name: string;
  utilityProvider: string;
  status: "active" | "paused" | "completed";
  color: string;
  createdAt: string;
}

export async function getCampaigns(): Promise<CampaignRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const c = await ctx();
    if (!c) return [];
    const { data } = await c.supabase
      .from("campaigns")
      .select("*")
      .eq("owner_id", c.user.id)
      .order("created_at", { ascending: false });
    return (data ?? []).map((r: Row) => ({
      id: s(r.id),
      name: s(r.name),
      utilityProvider: s(r.utility_provider),
      status: (s(r.status) || "active") as CampaignRow["status"],
      color: s(r.color) || "#3B82F6",
      createdAt: s(r.created_at),
    }));
  } catch {
    return [];
  }
}

export async function createCampaign(input: {
  name: string;
  utilityProvider?: string;
  color?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured())
    return { ok: false, error: "Connect Supabase to create campaigns." };
  try {
    const c = await ctx();
    if (!c) return { ok: false, error: "You must be signed in." };
    const { error } = await c.supabase.from("campaigns").insert({
      owner_id: c.user.id,
      name: input.name,
      utility_provider: input.utilityProvider ?? "",
      color: input.color ?? "#3B82F6",
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function setCampaignStatus(
  id: string,
  status: "active" | "paused" | "completed",
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Not configured." };
  try {
    const c = await ctx();
    if (!c) return { ok: false, error: "You must be signed in." };
    const { error } = await c.supabase
      .from("campaigns")
      .update({ status })
      .eq("id", id)
      .eq("owner_id", c.user.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

// ── Appointments ─────────────────────────────────────────────────────────────
export interface AppointmentRow {
  id: string;
  leadName: string;
  status: string;
  source: string;
  scheduledLabel: string;
  scheduledAt: string | null;
  notes: string;
  createdAt: string;
}

export async function getAppointments(): Promise<AppointmentRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const c = await ctx();
    if (!c) return [];
    // Finalize any stuck calls first so freshly-booked reviews show immediately.
    await reconcileOwnerActiveCalls();
    const { data } = await c.supabase
      .from("appointments")
      .select("*")
      .eq("owner_id", c.user.id)
      .order("created_at", { ascending: false });
    return (data ?? []).map((r: Row) => ({
      id: s(r.id),
      leadName: s(r.lead_name) || "Homeowner",
      status: s(r.status) || "scheduled",
      source: s(r.source) || "ai",
      scheduledLabel: s(r.scheduled_label),
      scheduledAt: r.scheduled_at ? s(r.scheduled_at) : null,
      notes: s(r.notes),
      createdAt: s(r.created_at),
    }));
  } catch {
    return [];
  }
}

// ── Callbacks ────────────────────────────────────────────────────────────────
export interface CallbackRow {
  id: string;
  leadName: string;
  phone: string;
  reason: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
}

export async function getCallbacks(): Promise<CallbackRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const c = await ctx();
    if (!c) return [];
    const { data } = await c.supabase
      .from("callbacks")
      .select("*")
      .eq("owner_id", c.user.id)
      .order("due_at", { ascending: true });
    return (data ?? []).map((r: Row) => ({
      id: s(r.id),
      leadName: s(r.lead_name) || "Homeowner",
      phone: s(r.phone),
      reason: s(r.reason),
      status: s(r.status) || "due",
      dueAt: r.due_at ? s(r.due_at) : null,
      createdAt: s(r.created_at),
    }));
  } catch {
    return [];
  }
}
