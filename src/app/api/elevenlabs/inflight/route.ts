import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { LIVE_STATES } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Which of these conversations are STILL LIVE?
 *
 * This is what makes the dialer's concurrency limit real. The pump can only hold
 * itself to N simultaneous calls if it knows when a call has ended — otherwise it
 * either stalls forever (never freeing a slot) or, as the old code did, ignores
 * the question entirely and just launches N more every 8 seconds.
 *
 * Deliberately NOT the Live Monitor endpoint: that one is gated behind
 * `monitor.view`, which reps don't have, and it reconciles the whole floor. This
 * is a cheap own-scoped id lookup a rep can call every few seconds.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = (Array.isArray(body.ids) ? body.ids : [])
    .filter((s) => typeof s === "string")
    .slice(0, 200);

  if (!ids.length || !isSupabaseConfigured()) {
    return NextResponse.json({ active: [] });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ active: [] });

    // Own-scoped, AND within the CURRENT org — a conversation this account owns
    // from a past org must never be treated as one of THIS session's in-flight
    // calls (it would silently eat a concurrency slot for a call that isn't
    // actually part of the current campaign).
    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;

    // Service role when available: the pump must see the row even if a webhook
    // wrote it from a context RLS would hide. Still hard-scoped to the caller.
    const reader = isAdminConfigured() ? createAdminClient() : supabase;
    let query = reader
      .from("ai_conversations")
      .select("conversation_id, state, outcome")
      .eq("owner_id", user.id);
    if (orgId) query = query.eq("org_id", orgId);
    // No state filter: we want BOTH the still-live rows (to hold their concurrency
    // slot) AND the just-ended ones' outcomes (so the pump's double-dial can tell a
    // no-answer from a real conversation without a second round-trip).
    const { data } = await query.in("conversation_id", ids);

    const live = new Set(LIVE_STATES as unknown as string[]);
    const rows = (data ?? []) as { conversation_id: unknown; state: unknown; outcome: unknown }[];
    const active: string[] = [];
    const ended: { id: string; outcome: string | null }[] = [];
    for (const r of rows) {
      const id = String(r.conversation_id);
      // 'ringing' counts as live — freeing its slot the moment it rings would let
      // the pump launch a replacement on top of it (silent over-dialing).
      if (live.has(String(r.state))) active.push(id);
      else ended.push({ id, outcome: r.outcome == null ? null : String(r.outcome) });
    }

    return NextResponse.json({ active, ended });
  } catch {
    // On error, report nothing active. Releasing a slot we shouldn't have is
    // recoverable (we dial one extra); stalling the pump forever is not.
    return NextResponse.json({ active: [], ended: [] });
  }
}
