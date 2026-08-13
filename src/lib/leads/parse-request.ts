import "server-only";

import { aiParseLeads, canAIParse } from "../ai/parse-leads";
import { isConfident, parseSheet, rowsToLeads, type ParsedLead } from "./csv";
import type { LeadFieldDef } from "./field-schema";

// ─────────────────────────────────────────────────────────────────────────────
// Shared CSV → ParsedLead[] parsing chain, extracted out of
// /api/leads/import/route.ts so the geography auto-sort preview route
// (/api/leads/sort-preview) can run the exact same column-mapping logic without
// duplicating it. Tries the fast deterministic header mapper first; falls back
// to Claude to infer the column layout when that can't confidently read the
// file (no header row, broker exports, exotic layouts).
// ─────────────────────────────────────────────────────────────────────────────

export interface ParseCsvResult {
  leads: ParsedLead[];
  source: "headers" | "ai";
  aiError: string | null;
  /** Typed defs for every column captured into customFields — the import route
   *  appends the new ones to the org's settings.leadFields after inserting. */
  discoveredFields: LeadFieldDef[];
}

export async function parseCsvToLeads(
  csv: string,
): Promise<ParseCsvResult | { error: string }> {
  if (!csv || !csv.trim()) return { error: "That file looks empty." };

  const grid = parseSheet(csv);
  if (grid.length < 2) {
    return { error: "That file has no data rows under the first line." };
  }

  const deterministic = rowsToLeads(grid);
  let leads: ParsedLead[];
  let source: "headers" | "ai";
  let aiError: string | null = null;
  let discoveredFields = deterministic.discoveredFields;

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
      if (ai.leads.length) discoveredFields = ai.discoveredFields;
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

  if (!leads.length) {
    return {
      error:
        aiError ??
        "Couldn't find any leads in that file. Make sure it has a phone or name column.",
    };
  }

  return { leads, source, aiError, discoveredFields };
}
