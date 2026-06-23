import { NextResponse } from "next/server";
import { insertLeads, type LeadInput } from "@/lib/db/leads";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    rows?: LeadInput[];
    campaignId?: string | null;
  };
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json(
      { inserted: 0, error: "No rows to import." },
      { status: 400 },
    );
  }
  // Assign the whole batch to the chosen campaign (if any).
  const rows = body.rows
    .slice(0, 5000)
    .map((r) => (body.campaignId ? { ...r, campaignId: body.campaignId } : r));
  const result = await insertLeads(rows);
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
