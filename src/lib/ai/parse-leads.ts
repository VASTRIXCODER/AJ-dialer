import "server-only";

import {
  captureToFieldDef,
  looksLikePhone,
  MAX_CUSTOM_FIELDS,
  recoverPhone,
  sampleColumn,
  type ParsedLead,
  type ParseResult,
} from "@/lib/leads/csv";
import {
  detectFieldType,
  normalizeFieldKey,
  parseFieldValue,
  RESERVED_FIELD_KEYS,
  type LeadFieldType,
} from "@/lib/leads/field-schema";
import { isValidPhone, normalizePhone } from "@/lib/utils";
import { generateJSON, generateJSONLoose, isAIConfigured } from "./claude";

// ─────────────────────────────────────────────────────────────────────────────
// AI-assisted lead extraction.
//
// For CSVs the deterministic header mapper can't read — no header row, exotic
// column orders, data-broker exports with many phone/email columns — we send
// Claude a SAMPLE of rows and ask it to identify which column index holds each
// field. The returned mapping is then applied to every row in code (one cheap
// model call per import, never one per row). Phone numbers are normalized the
// same way everywhere, so "+1…", "1…" and bare 10-digit numbers all work.
// ─────────────────────────────────────────────────────────────────────────────

interface PhoneCol {
  numberCol: number;
  /** Column holding a "Do Not Call"/status flag for this number (-1 if none). */
  dncCol: number;
}

interface ColumnMapping {
  hasHeader: boolean;
  firstNameCol: number;
  lastNameCol: number;
  fullNameCol: number;
  addressCol: number;
  /** Secondary address line / unit / apt / suite column (-1 if none). */
  address2Col: number;
  cityCol: number;
  stateCol: number;
  zipCol: number;
  utilityBillCol: number;
  emailCols: number[];
  phoneCols: PhoneCol[];
  /** Extra useful columns (gender, age, marital, net worth, …) — captured as
   *  typed custom fields on every lead. */
  extras: { label: string; col: number }[];
}

const MAPPING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    hasHeader: { type: "boolean" },
    firstNameCol: { type: "integer" },
    lastNameCol: { type: "integer" },
    fullNameCol: { type: "integer" },
    addressCol: { type: "integer" },
    address2Col: { type: "integer" },
    cityCol: { type: "integer" },
    stateCol: { type: "integer" },
    zipCol: { type: "integer" },
    utilityBillCol: { type: "integer" },
    emailCols: { type: "array", items: { type: "integer" } },
    phoneCols: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          numberCol: { type: "integer" },
          dncCol: { type: "integer" },
        },
        required: ["numberCol", "dncCol"],
      },
    },
    extras: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { label: { type: "string" }, col: { type: "integer" } },
        required: ["label", "col"],
      },
    },
  },
  required: [
    "hasHeader", "firstNameCol", "lastNameCol", "fullNameCol", "addressCol",
    "address2Col", "cityCol", "stateCol", "zipCol", "utilityBillCol", "emailCols",
    "phoneCols", "extras",
  ],
} as const;

const SYSTEM =
  "You map spreadsheet columns to a CRM lead schema. You are given the first rows " +
  "of a CSV (as JSON arrays of cell strings). The file may or may not have a header " +
  "row. Use 0-based column indices, and -1 for any field that is not present. Identify " +
  "EVERY phone-number column (in priority order) and, for each, the index of an " +
  "adjacent Do-Not-Call/status column if one exists (else -1).\n" +
  "A PHONE column holds 10-digit US phone numbers — optionally with a country code, " +
  "spaces, dashes, parentheses, or a leading +1. It is NOT a record/account ID " +
  "(usually 11–13 digits), a ZIP code (5 digits), a date, a dollar amount, or a year. " +
  "Look at the actual values, not just the position; pick the columns whose values " +
  "look like real phone numbers.\n" +
  "ADDRESS: capture the COMPLETE street address. `addressCol` is the main street " +
  "line (house number + street), or a single combined column that already includes " +
  "city/state/zip. If the street is split across a second column — 'Address Line 2', " +
  "a unit / apt / suite, or a separate house-number vs street-name pair — put that " +
  "second column in `address2Col` (else -1) so the full address is preserved. Map " +
  "city / state / zip to their own columns when they're separate; set them to -1 " +
  "when the address is one combined column. Prefer the column with the fullest " +
  "address; never pick a partial one if a more complete column exists.\n" +
  "NAME: set firstNameCol/lastNameCol when separate, otherwise fullNameCol for a " +
  "single full-name column.\n" +
  "List all email columns. Put other useful person data (gender, age or date of birth, " +
  "marital status, net worth, income, occupation, owner type) into " +
  "`extras` with a short human label for each. Never guess a column that isn't clearly " +
  "that field.\n\n" +
  "Return a JSON object with EXACTLY these keys:\n" +
  "{\n" +
  '  "hasHeader": boolean,\n' +
  '  "firstNameCol": integer, "lastNameCol": integer, "fullNameCol": integer,\n' +
  '  "addressCol": integer, "address2Col": integer, "cityCol": integer,\n' +
  '  "stateCol": integer, "zipCol": integer,\n' +
  '  "utilityBillCol": integer,\n' +
  '  "emailCols": integer[],\n' +
  '  "phoneCols": [{ "numberCol": integer, "dncCol": integer }],\n' +
  '  "extras": [{ "label": string, "col": integer }]\n' +
  "}";

/** Build a compact, token-bounded sample of the grid for the model. */
function sampleFor(grid: string[][]): string {
  const rows = grid.slice(0, 12).map((r) => r.map((c) => (c ?? "").slice(0, 50)));
  const colCount = grid.reduce((m, r) => Math.max(m, r.length), 0);
  return `Columns: ${colCount}. Rows (each is an array of cells, index 0..${colCount - 1}):\n${JSON.stringify(rows)}`;
}

async function inferColumns(grid: string[][]): Promise<ColumnMapping> {
  const prompt = sampleFor(grid);
  // Plain JSON first (most compatible — independent of the output_config.format
  // shape, which varies across API versions). Fall back to structured outputs if
  // the loose parse somehow fails.
  try {
    return await generateJSONLoose<ColumnMapping>({
      system: SYSTEM,
      prompt,
      maxTokens: 1024,
    });
  } catch {
    return generateJSON<ColumnMapping>({
      system: SYSTEM,
      prompt,
      schema: MAPPING_SCHEMA as Record<string, unknown>,
      schemaName: "lead_column_mapping",
      effort: "low",
      maxTokens: 1024,
    });
  }
}

const cell = (row: string[], i: number) =>
  i >= 0 && i < row.length ? (row[i] ?? "").trim() : "";

const isDnc = (v: string) => /do\s*not\s*call|dnc|opt(ed)?\s*out/i.test(v);

/**
 * Type the mapping's `extras` columns the same way the deterministic path types
 * unmapped columns: normalize the AI's label to a snake_case key, detect the
 * column's type from its values, drop empty/colliding/dataless columns, and cap
 * at MAX_CUSTOM_FIELDS.
 */
function typedExtras(
  grid: string[][],
  m: ColumnMapping,
  start: number,
): { col: number; key: string; label: string; type: LeadFieldType }[] {
  const captures: { col: number; key: string; label: string; type: LeadFieldType }[] = [];
  const seen = new Set<string>();
  for (const ex of m.extras ?? []) {
    if (captures.length >= MAX_CUSTOM_FIELDS) break;
    const label = (ex.label ?? "").trim();
    if (!label || !Number.isInteger(ex.col) || ex.col < 0) continue;
    const key = normalizeFieldKey(label);
    if (!key || seen.has(key)) continue;
    if (RESERVED_FIELD_KEYS.has(key)) continue; // never shadow live columns
    const samples = sampleColumn(grid, ex.col, start);
    if (!samples.length) continue;
    seen.add(key);
    captures.push({ col: ex.col, key, label, type: detectFieldType(samples) });
  }
  return captures;
}

/** Apply an inferred mapping to every data row. */
function applyMapping(grid: string[][], m: ColumnMapping): ParseResult {
  const start = m.hasHeader ? 1 : 0;
  const extras = typedExtras(grid, m, start);
  const out: ParsedLead[] = [];
  let noPhone = 0;

  for (let r = start; r < grid.length; r++) {
    const row = grid[r];
    if (!row.some((c) => (c ?? "").trim())) continue;

    let firstName = cell(row, m.firstNameCol);
    let lastName = cell(row, m.lastNameCol);
    if (!firstName && !lastName && m.fullNameCol >= 0) {
      const parts = cell(row, m.fullNameCol).split(/\s+/).filter(Boolean);
      firstName = parts[0] ?? "";
      lastName = parts.slice(1).join(" ");
    }

    // Phones: normalize each, prefer the first dialable number NOT flagged DNC.
    const phones = m.phoneCols
      .map((p) => {
        const raw = cell(row, p.numberCol);
        return {
          raw,
          // Guard against a mis-mapped money/ID column producing a fake phone.
          e164: looksLikePhone(raw) ? normalizePhone(raw) : "",
          dnc: p.dncCol >= 0 && isDnc(cell(row, p.dncCol)),
        };
      })
      .filter((p) => p.raw);
    const callable = phones.filter((p) => p.e164 && !p.dnc);
    const anyValid = phones.filter((p) => p.e164);
    const primary = callable[0] ?? anyValid[0];
    // Recovery net: if the AI's phone columns didn't yield a dialable number for
    // this row (wrong mapping, blank cell), find the first valid phone anywhere
    // in the row so a number is never lost.
    const phone = primary ? primary.e164 : recoverPhone(row);

    const emails = m.emailCols.map((i) => cell(row, i)).filter(Boolean);

    // Extra columns become TYPED custom fields (they used to be squashed into
    // notes). Spare phones/emails and DNC flags stay in notes as before.
    let customFields: Record<string, string | number | boolean> | undefined;
    for (const ex of extras) {
      const v = cell(row, ex.col);
      if (v) (customFields ??= {})[ex.key] = parseFieldValue(v, ex.type);
    }
    const noteParts: string[] = [];
    const otherPhones = anyValid.filter((p) => p.e164 !== phone).map((p) => p.e164);
    if (otherPhones.length) noteParts.push(`Other numbers: ${otherPhones.join(", ")}`);
    if (emails.length > 1) noteParts.push(`Other emails: ${emails.slice(1).join(", ")}`);
    if (phones.some((p) => p.dnc)) noteParts.push("Some numbers flagged Do Not Call");

    const billRaw = cell(row, m.utilityBillCol).replace(/[^0-9.]/g, "");
    const bill = billRaw ? Number(billRaw) : NaN;

    // Combine the street line + any unit / line-2 column into one full address
    // so multi-column addresses are never truncated to just the street number.
    const address =
      [cell(row, m.addressCol), cell(row, m.address2Col)]
        .filter(Boolean)
        .join(", ") || undefined;

    const lead: ParsedLead = {
      firstName,
      lastName,
      phone,
      email: emails[0] || undefined,
      address,
      city: cell(row, m.cityCol) || undefined,
      state: cell(row, m.stateCol) || undefined,
      zip: cell(row, m.zipCol) || undefined,
      notes: noteParts.join("; ") || undefined,
    };
    if (!Number.isNaN(bill) && bill > 0) lead.utilityBill = bill;
    if (customFields) lead.customFields = customFields;

    if (!lead.phone && !firstName && !lastName) continue;
    if (!isValidPhone(lead.phone)) noPhone++;
    out.push(lead);
  }

  return {
    leads: out,
    noPhone,
    sawPhoneColumn: m.phoneCols.length > 0,
    discoveredFields: extras.map(captureToFieldDef),
  };
}

/** True when Claude can be used to parse leads. */
export const canAIParse = isAIConfigured;

/** Infer the schema with Claude and extract every lead. Throws if AI is off. */
export async function aiParseLeads(grid: string[][]): Promise<ParseResult> {
  const mapping = await inferColumns(grid);
  return applyMapping(grid, mapping);
}
