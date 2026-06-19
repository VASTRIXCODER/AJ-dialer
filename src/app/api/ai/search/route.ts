import { NextResponse } from "next/server";
import { getSemanticSearch } from "@/lib/ai/services";
import { getLeadById, leads } from "@/lib/data";

export async function POST(req: Request) {
  const { query } = await req.json().catch(() => ({}) as { query?: string });
  if (!query || !query.trim()) {
    return NextResponse.json({ source: "demo", interpretation: "", matches: [] });
  }

  const { data, source } = await getSemanticSearch(query, leads);

  // Enrich AI matches with display fields so the palette can render rich rows.
  const matches = data.matches
    .map((m) => {
      const l = getLeadById(m.id);
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
