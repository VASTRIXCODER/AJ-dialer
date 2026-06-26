import { NextResponse } from "next/server";
import { aiParseLeads, canAIParse } from "@/lib/ai/parse-leads";
import { insertLeads, type LeadInput } from "@/lib/db/leads";
import { isConfident, parseSheet, rowsToLeads, type ParsedLead } from "@/lib/leads/csv";

export const dynamic = "force-dynamic";

/**
 * Import leads from a CSV.
 *
 * Preferred: send the raw file text as `csv`. The server parses it, tries the
 * fast deterministic header mapper, and — when that can't confidently read the
 * file (no header row, broker exports, exotic layouts) — falls back to Claude to
 * infer the column mapping. Either way every field is extracted and phone numbers
 * are normalized to E.164.
 *
 * Back-compat: callers may still send pre-parsed `rows`.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    csv?: string;
    rows?: LeadInput[];
    campaignId?: string | null;
  };

  let leads: ParsedLead[] | LeadInput[] = [];
  let source: "headers" | "ai" | "rows" = "rows";
  let aiError: string | null = null;

  if (typeof body.csv === "string" && body.csv.trim()) {
    const grid = parseSheet(body.csv);
    if (grid.length < 2) {
      return NextResponse.json(
        { inserted: 0, error: "That file has no data rows under the first line." },
        { status: 400 },
      );
    }
    const deterministic = rowsToLeads(grid);
    if (isConfident(deterministic)) {
      leads = deterministic.leads;
      source = "headers";
    } else if (canAIParse()) {
      // Let Claude figure out the column layout. If the call fails, record why
      // and fall back to whatever the deterministic pass managed.
      try {
        const ai = await aiParseLeads(grid);
        leads = ai.leads.length ? ai.leads : deterministic.leads;
        source = ai.leads.length ? "ai" : "headers";
      } catch (e) {
        aiError = e instanceof Error ? e.message : "AI parsing failed.";
        leads = deterministic.leads;
        source = "headers";
      }
    } else {
      // No header mapping AND no AI available — tell the user exactly why.
      aiError =
        "This file has no recognizable header row, so AI column mapping is needed — but ANTHROPIC_API_KEY isn't configured on the server.";
      leads = deterministic.leads;
      source = "headers";
    }
  } else if (Array.isArray(body.rows)) {
    leads = body.rows;
  }

  if (!leads.length) {
    return NextResponse.json(
      {
        inserted: 0,
        error:
          aiError ??
          "Couldn't find any leads in that file. Make sure it has a phone or name column.",
      },
      { status: 400 },
    );
  }

  // Assign the whole batch to the chosen campaign (if any).
  const rows: LeadInput[] = leads
    .slice(0, 10000)
    .map((r) => (body.campaignId ? { ...r, campaignId: body.campaignId } : { ...r }));

  const result = await insertLeads(rows);
  return NextResponse.json(
    { ...result, source, aiError },
    { status: result.error ? 400 : 200 },
  );
}
