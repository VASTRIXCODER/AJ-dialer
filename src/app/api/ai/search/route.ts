import { NextResponse } from "next/server";
import { getSemanticSearch } from "@/lib/ai/services";
import { getLeads } from "@/lib/db/leads";
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
  const leads = await getLeads();
  // No accessible leads → nothing to search; skip the model call entirely.
  if (!leads.length) {
    return NextResponse.json({ source: "demo", interpretation: "", matches: [] });
  }
  const isSolar = viewer.org ? viewer.org.dialerTemplate === "solar" : true;
  const { data, source } = await getSemanticSearch(query, leads, isSolar);
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
