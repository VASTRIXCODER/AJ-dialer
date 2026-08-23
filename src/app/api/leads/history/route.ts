import { NextRequest, NextResponse } from "next/server";
import { CONNECTED_OUTCOMES } from "@/lib/call-analytics";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { CallOutcome } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * This lead's recent calls — what the dialer shows before a rep dials, so nobody
 * re-calls someone who was spoken to yesterday.
 *
 * It now also reports whether each call left a recording, a transcript or rep
 * notes, so the panel can link straight into them. Presence booleans only: a
 * transcript can run to thousands of words and this is a preview strip, not a
 * reader — the reader fetches the body on demand.
 */
export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId");
  if (!leadId || !UUID.test(leadId)) {
    return NextResponse.json({ calls: [] });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ calls: [] });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ calls: [] });

    const { data } = await supabase
      .from("call_records")
      .select(
        "id,started_at,duration_sec,outcome,channel,summary,notes,recording_url,transcript_text,conversation_id",
      )
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false })
      .limit(8);

    const calls = (data ?? []).map((r: Record<string, unknown>) => {
      const channel = r.channel === "ai" ? "ai" : "human";
      const outcome = r.outcome ? (String(r.outcome) as CallOutcome) : null;
      // Same rule the archive uses: an AI call's audio is fetched by conversation
      // id and only exists once somebody actually picked up.
      const hasRecording =
        channel === "ai"
          ? Boolean(r.conversation_id && outcome && CONNECTED_OUTCOMES.has(outcome))
          : Boolean(r.recording_url);
      return {
        id: String(r.id),
        startedAt: String(r.started_at ?? ""),
        durationSec: r.duration_sec == null ? 0 : Number(r.duration_sec),
        outcome,
        channel,
        summary: r.summary ? String(r.summary) : null,
        hasNotes: Boolean(String(r.notes ?? "").trim()),
        hasRecording,
        hasTranscript: Boolean(String(r.transcript_text ?? "").trim()),
      };
    });

    return NextResponse.json({ calls });
  } catch {
    return NextResponse.json({ calls: [] });
  }
}
