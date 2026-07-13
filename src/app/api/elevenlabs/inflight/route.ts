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

    // Service role when available: the pump must see the row even if a webhook
    // wrote it from a context RLS would hide. Still hard-scoped to the caller.
    const reader = isAdminConfigured() ? createAdminClient() : supabase;
    const { data } = await reader
      .from("ai_conversations")
      .select("conversation_id, state")
      .eq("owner_id", user.id)
      .in("conversation_id", ids)
      // LIVE_STATES, not a hand-written list — a call whose phone is RINGING is
      // very much still in flight. Omitting 'ringing' here would free its
      // concurrency slot the moment it started ringing, and the pump would launch
      // a replacement call on top of it: silent over-dialing, every batch.
      .in("state", LIVE_STATES as unknown as string[]);

    return NextResponse.json({
      active: (data ?? []).map((r) => String(r.conversation_id)),
    });
  } catch {
    // On error, report nothing active. Releasing a slot we shouldn't have is
    // recoverable (we dial one extra); stalling the pump forever is not.
    return NextResponse.json({ active: [] });
  }
}
