import { NextResponse } from "next/server";
import { getLeadPanelResult } from "@/lib/db/lead-360";
import { getLeadTimeline } from "@/lib/db/lead-timeline";
import { getScope } from "@/lib/db/scope";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * The Lead 360 payload: the assembled panel + the first timeline page.
 * Authorization lives inside the db functions (same scope as every lead read):
 * 401 signed out, 403 in-org-but-not-your-book, 404 unknown/foreign.
 *
 * `?before=<iso>` returns ONLY an older timeline page (the drawer's
 * "Load older" — no point re-assembling the whole panel for a scroll).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Generous per-user limit — the drawer polls every 20s and refetches on
  // focus, so a floor of open tabs stays well inside 240/min.
  const scope = isSupabaseConfigured() ? await getScope() : null;
  const key = `lead360:${scope?.userId ?? clientIp(req)}`;
  const rate = rateLimit(key, 240, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Slow down a little." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    );
  }

  const url = new URL(req.url);
  const before = url.searchParams.get("before");

  if (before) {
    const timeline = await getLeadTimeline(id, { before, limit: 50 });
    if (timeline === null) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({ timeline });
  }

  const result = await getLeadPanelResult(id);
  if (!result.ok) {
    const status =
      result.reason === "unauthenticated" ? 401 : result.reason === "denied" ? 403 : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }
  const timeline = (await getLeadTimeline(id, { limit: 50 })) ?? [];
  return NextResponse.json({ panel: result.panel, timeline });
}
