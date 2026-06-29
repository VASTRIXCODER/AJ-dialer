import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      .select("id,started_at,duration_sec,outcome,channel,summary")
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false })
      .limit(8);

    const calls = (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      startedAt: String(r.started_at ?? ""),
      durationSec: r.duration_sec == null ? 0 : Number(r.duration_sec),
      outcome: r.outcome ? String(r.outcome) : null,
      channel: r.channel ? String(r.channel) : "human",
      summary: r.summary ? String(r.summary) : null,
    }));

    return NextResponse.json({ calls });
  } catch {
    return NextResponse.json({ calls: [] });
  }
}
