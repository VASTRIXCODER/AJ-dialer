import "server-only";

import {
  aiInferMapping,
  applyAIMapping,
  canAIParse,
  resolveAIExtras,
  type ColumnMapping,
} from "../ai/parse-leads";
import { isValidPhone } from "../utils";
import {
  isConfident,
  parseSheet,
  resolveHeaderPlan,
  rowsToLeads,
  type CustomCapture,
  type Field,
  type ParsedLead,
  type ParseResult,
} from "./csv";
import {
  normalizeFieldKey,
  RESERVED_FIELD_KEYS,
  type LeadFieldDef,
  type LeadFieldType,
} from "./field-schema";
import { normalizeParsedLeads } from "./normalize";

// ─────────────────────────────────────────────────────────────────────────────
// Shared CSV → ParsedLead[] parsing chain, used by /api/leads/import and by the
// geography auto-sort preview (/api/leads/sort-preview) so both read a file the
// same way.
//
// WHAT CHANGED AND WHY. Claude used to be a LAST RESORT here: it ran only when
// the deterministic header mapper couldn't confidently read the file. In practice
// that meant it essentially never ran — any CSV with a header row that mapped a
// phone column and half the names passed `isConfident`, so real customer imports
// went through the regex mapper alone and the AI column mapping the product
// advertises was dead code on the happy path. The failure that hides behind that
// is the quiet one: a mis-mapped column doesn't error, it just files a carrier
// name as the utility provider, or reads the second phone column and leaves the
// mobile behind, and nobody finds out until a rep dials.
//
// So the model now runs on EVERY import where a key is configured, ALONGSIDE the
// deterministic pass rather than instead of it — and the two are judged on the
// same measurable thing: how much dialable, named, locatable lead data each one
// actually got out of the same grid (scoreParse). The deterministic result keeps
// the file unless the model beats it by a clear margin, so this can't regress a
// file that already parsed correctly, and it costs ONE model call per upload —
// the resolved ColumnPlan is handed back and replayed across every later chunk.
// ─────────────────────────────────────────────────────────────────────────────

/** The upload's column layout, resolved once and replayed for every chunk. */
export type ColumnPlan =
  | { kind: "headers"; header: Field[]; captures: CustomCapture[] }
  | { kind: "ai"; mapping: ColumnMapping; captures: CustomCapture[] };

export interface ParseCsvResult {
  leads: ParsedLead[];
  source: "headers" | "ai";
  aiError: string | null;
  /** Typed defs for every column captured into customFields — the import route
   *  appends the new ones to the org's settings.leadFields after inserting. */
  discoveredFields: LeadFieldDef[];
  /** Replay this on the rest of the upload's chunks: same columns, same types,
   *  no second model call. */
  plan: ColumnPlan;
  /** Data rows this CSV contained (header excluded). */
  fileRows: number;
  /** Rows that carried neither a phone nor a name, so they became no lead.
   *  Reported rather than quietly dropped: "9,000 rows in, 8,600 leads out" is
   *  only reassuring if the other 400 are accounted for. */
  skippedRows: number;
}

/** Every value `mapHeader` can return — the allowlist for a plan off the wire. */
const FIELDS = new Set<string>([
  "firstName", "lastName", "phone", "email", "address", "city", "state", "zip",
  "utilityProvider", "solarProvider", "utilityBill", "solarPayment", "notes",
  "name", "address2",
]);

const FIELD_TYPES = new Set<string>([
  "text", "number", "currency", "boolean", "date", "phone", "email", "url",
]);

const int = (v: unknown, fallback = -1): number =>
  Number.isInteger(v) ? (v as number) : fallback;

/**
 * A ColumnPlan reaches later chunks by way of the browser, so it is UNTRUSTED
 * input by the time it comes back — exactly like the `discoveredFields` the
 * sort-preview round trip carries (see sanitizeDiscoveredFields). Column indices
 * are only ever used to index a row array, so an out-of-range one is harmless,
 * but field names and capture keys are not: an unrecognised field name would be
 * written straight onto the lead object, and a capture key that isn't normalized
 * (or is reserved) would shadow a real column. Rebuild the plan from scratch out
 * of values we recognise, and drop anything we don't.
 */
export function sanitizeColumnPlan(raw: unknown): ColumnPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  const captures: CustomCapture[] = [];
  const seen = new Set<string>();
  if (Array.isArray(p.captures)) {
    for (const item of p.captures) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;
      const col = int(c.col, -1);
      const key = String(c.key ?? "");
      const type = String(c.type ?? "");
      if (col < 0) continue;
      // REJECT rather than re-normalize: a renamed key would register the def
      // under a different name than the row values carry (see csv.ts).
      if (!key || key !== normalizeFieldKey(key) || seen.has(key)) continue;
      if (RESERVED_FIELD_KEYS.has(key) || !FIELD_TYPES.has(type)) continue;
      seen.add(key);
      captures.push({
        col,
        key,
        label: String(c.label ?? "").trim().slice(0, 80) || key,
        type: type as LeadFieldType,
      });
    }
  }

  if (p.kind === "headers") {
    if (!Array.isArray(p.header)) return null;
    const header: Field[] = p.header.map((h) =>
      typeof h === "string" && FIELDS.has(h) ? (h as Field) : null,
    );
    return { kind: "headers", header, captures };
  }

  if (p.kind === "ai") {
    const m = p.mapping as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object") return null;
    const mapping: ColumnMapping = {
      hasHeader: m.hasHeader !== false,
      firstNameCol: int(m.firstNameCol),
      lastNameCol: int(m.lastNameCol),
      fullNameCol: int(m.fullNameCol),
      addressCol: int(m.addressCol),
      address2Col: int(m.address2Col),
      cityCol: int(m.cityCol),
      stateCol: int(m.stateCol),
      zipCol: int(m.zipCol),
      utilityBillCol: int(m.utilityBillCol),
      emailCols: Array.isArray(m.emailCols)
        ? m.emailCols.map((c) => int(c)).filter((c) => c >= 0)
        : [],
      phoneCols: Array.isArray(m.phoneCols)
        ? m.phoneCols
            .map((c) => {
              const pc = (c ?? {}) as Record<string, unknown>;
              return { numberCol: int(pc.numberCol), dncCol: int(pc.dncCol) };
            })
            .filter((c) => c.numberCol >= 0)
        : [],
      // `extras` only drives capture discovery, which the sanitized `captures`
      // above already replaces — an empty list here keeps them from being
      // re-derived (and re-typed) from this chunk's data.
      extras: [],
    };
    return { kind: "ai", mapping, captures };
  }

  return null;
}

/**
 * How much usable lead data a parse actually got out of the file, per data row.
 *
 * The denominator is the GRID's row count, not the parse's own output length, so
 * a mapping that quietly discards rows can't win by having a tidier average. A
 * dialable phone is what makes a lead a lead, so it dominates; a name is what
 * makes the call personal; location and email are worth a point each because
 * they're what geography sorting and follow-up run on.
 */
export function scoreParse(result: ParseResult, dataRows: number): number {
  let score = 0;
  for (const l of result.leads) {
    if (isValidPhone(l.phone)) score += 4;
    if (l.firstName || l.lastName) score += 2;
    if (l.city || l.zip) score += 1;
    if (l.address) score += 1;
    if (l.email) score += 1;
  }
  return score / Math.max(1, dataRows);
}

/** The model has to be clearly better, not a coin-flip better, to take the file. */
const AI_WIN_MARGIN = 1.02;

const NO_KEY_NOTE =
  "This file has no recognizable header row, so AI column mapping is needed — " +
  "but ANTHROPIC_API_KEY isn't configured on the server.";

/** Data rows the grid holds under THIS plan — an AI plan may say there's no header. */
function dataRowsUnder(grid: string[][], plan: ColumnPlan): number {
  const headerRows = plan.kind === "ai" && !plan.mapping.hasHeader ? 0 : 1;
  return Math.max(0, grid.length - headerRows);
}

function finish(
  grid: string[][],
  result: ParseResult,
  source: "headers" | "ai",
  aiError: string | null,
  plan: ColumnPlan,
): ParseCsvResult | { error: string } {
  if (!result.leads.length) {
    return {
      error:
        aiError ??
        "Couldn't find any leads in that file. Make sure it has a phone or name column.",
    };
  }
  const fileRows = dataRowsUnder(grid, plan);
  return {
    // Reformat once the mapping is settled: the field's identity is what makes
    // "CALIFORNIA" → "CA" and ZIP 1001 → 01001 decidable. See ./normalize.ts.
    leads: normalizeParsedLeads(result.leads),
    source,
    aiError,
    discoveredFields: result.discoveredFields,
    plan,
    fileRows,
    skippedRows: Math.max(0, fileRows - result.leads.length),
  };
}

export async function parseCsvToLeads(
  csv: string,
  opts: { plan?: ColumnPlan | null } = {},
): Promise<ParseCsvResult | { error: string }> {
  if (!csv || !csv.trim()) return { error: "That file looks empty." };

  const grid = parseSheet(csv);
  if (grid.length < 2) {
    return { error: "That file has no data rows under the first line." };
  }

  // A later chunk of an upload whose layout is already settled. Replay it
  // verbatim — no model call, and no chance of this chunk reading the file
  // differently from the ones before it.
  if (opts.plan) {
    const plan = opts.plan;
    const replayed =
      plan.kind === "ai"
        ? applyAIMapping(grid, plan.mapping, plan.captures)
        : rowsToLeads(grid, { header: plan.header, captures: plan.captures });
    return finish(grid, replayed, plan.kind, null, plan);
  }

  const headerPlan = resolveHeaderPlan(grid);
  const deterministic = rowsToLeads(grid, headerPlan);
  const headersPlan: ColumnPlan = {
    kind: "headers",
    header: headerPlan.header,
    captures: headerPlan.captures,
  };

  if (!canAIParse()) {
    // No key. The header mapper is all we have — say so only when it visibly
    // struggled, so a perfectly ordinary CSV doesn't get flagged as a failure.
    const note = isConfident(deterministic) ? null : NO_KEY_NOTE;
    return finish(grid, deterministic, "headers", note, headersPlan);
  }

  const dataRows = Math.max(0, grid.length - 1);
  let aiError: string | null = null;

  try {
    const mapping = await aiInferMapping(grid);
    const captures = resolveAIExtras(grid, mapping, mapping.hasHeader ? 1 : 0);
    const ai = applyAIMapping(grid, mapping, captures);
    const aiPlan: ColumnPlan = { kind: "ai", mapping, captures };

    // Head-to-head on the same grid. The deterministic pass keeps the file
    // unless the model got MORE out of it — so a CSV the regex mapper already
    // reads correctly can never be made worse by this, and the headerless /
    // exotic / mis-mapped files are the ones that flip.
    if (scoreParse(ai, dataRows) > scoreParse(deterministic, dataRows) * AI_WIN_MARGIN) {
      return finish(grid, ai, "ai", null, aiPlan);
    }
    if (!deterministic.leads.length) return finish(grid, ai, "ai", null, aiPlan);
  } catch (e) {
    // Only an actual problem if the header mapper couldn't read the file either;
    // otherwise the import is fine and there's nothing to warn about.
    const message = e instanceof Error ? e.message : "AI parsing failed.";
    aiError = isConfident(deterministic)
      ? null
      : `AI column mapping didn't run: ${message}`;
  }

  return finish(grid, deterministic, "headers", aiError, headersPlan);
}
