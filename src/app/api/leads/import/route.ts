import { NextResponse } from "next/server";
import { insertLeads, type LeadInput } from "@/lib/db/leads";
import type { ParsedLead } from "@/lib/leads/csv";
import { parseCsvToLeads } from "@/lib/leads/parse-request";
import { LEAD_GROUPS, type LeadGroup } from "@/lib/types";
import { getViewer } from "@/lib/org/membership";

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
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { inserted: 0, error: "You don't have permission to import leads." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    csv?: string;
    rows?: LeadInput[];
    campaignId?: string | null;
    leadGroup?: LeadGroup | null;
  };

  const hasGroup = Object.prototype.hasOwnProperty.call(body, "leadGroup");
  if (hasGroup && body.leadGroup !== null && !LEAD_GROUPS.includes(body.leadGroup as LeadGroup)) {
    return NextResponse.json(
      { inserted: 0, error: `Invalid leadGroup. Must be one of: ${LEAD_GROUPS.join(", ")}.` },
      { status: 400 },
    );
  }

  let leads: ParsedLead[] | LeadInput[] = [];
  let source: "headers" | "ai" | "rows" = "rows";
  let aiError: string | null = null;

  if (typeof body.csv === "string" && body.csv.trim()) {
    const parsed = await parseCsvToLeads(body.csv);
    if ("error" in parsed) {
      return NextResponse.json({ inserted: 0, error: parsed.error }, { status: 400 });
    }
    leads = parsed.leads;
    source = parsed.source;
    aiError = parsed.aiError;
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

  // Assign the whole batch to the chosen campaign (if any) and/or fixed intake
  // group (if any). `hasGroup` distinguishes "leadGroup: null" (explicit
  // "unsorted") from the key being omitted entirely (legacy callers that never
  // mention groups, whose rows keep whatever lead_group they'd otherwise get).
  const rows: LeadInput[] = leads.slice(0, 5000).map((r) => ({
    ...r,
    ...(body.campaignId ? { campaignId: body.campaignId } : {}),
    ...(hasGroup ? { leadGroup: body.leadGroup } : {}),
  }));

  const result = await insertLeads(rows);
  return NextResponse.json(
    { ...result, source, aiError },
    { status: result.error ? 400 : 200 },
  );
}
