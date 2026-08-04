import { NextResponse } from "next/server";
import { getSemanticSearch } from "@/lib/ai/services";
import { getLeads } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";

export async function POST(req: Request) {
  const { query } = await req.json().catch(() => ({}) as { query?: string });
  if (!query || !query.trim()) {
    return NextResponse.json({ source: "demo", interpretation: "", matches: [] });
  }

  const [leads, viewer] = await Promise.all([getLeads(), getViewer()]);
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
