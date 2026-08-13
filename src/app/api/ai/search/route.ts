import { NextResponse } from "next/server";
import { orgAIContext } from "@/lib/ai/org-context";
import { getSemanticSearch } from "@/lib/ai/services";
import { searchLeadCandidates } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const { query } = await req.json().catch(() => ({}) as { query?: string });
  if (!query || !query.trim()) {
    return NextResponse.json({ source: "demo", interpretation: "", matches: [] });
  }

  // Require a signed-in user: this embeds the caller's raw query into a Claude
  // prompt, so an anonymous caller could otherwise run up unmetered Anthropic
  // spend (and use it as a prompt-injection surface).
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  // Each query is a Claude call — throttle so it can't be run up in a loop.
  const rl = rateLimit(`ai-search:${viewer.user?.id ?? clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { source: "demo", interpretation: "", matches: [] },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  // STAGE 1 — retrieve a bounded candidate set in SQL (or the JS twin in demo/
  // degraded mode) instead of pulling the viewer's entire book and slicing the
  // first 80: the whole book is now searchable, and each keystroke batch costs
  // two indexed queries rather than a full-table page-through.
  const leads = await searchLeadCandidates(query);
  // No candidates → nothing to rerank; skip the model call entirely and return
  // the palette's empty shape ("demo" is its well-defined no-model source).
  if (!leads.length) {
    return NextResponse.json({ source: "demo", interpretation: "", matches: [] });
  }
  const ctx = orgAIContext(viewer.org);
  const { data, source } = await getSemanticSearch(query, leads, ctx.isSolar, ctx);
  const byId = new Map(leads.map((l) => [l.id, l]));

  // Enrich AI matches with display fields so the palette can render rich rows.
  const matches = data.matches
    .map((m) => {
      const l = byId.get(m.id);
      if (!l) return null;
      return {
        id: l.id,
        reason: m.reason,
        name: `${l.firstName} ${l.lastName}`,
        city: l.city,
        state: l.state,
        utilityBill: l.utilityBill ?? null,
        status: l.status,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ source, interpretation: data.interpretation, matches });
}
