import "server-only";

import type { ParsedLead, ParseResult } from "@/lib/leads/csv";
import { isValidPhone, normalizePhone } from "@/lib/utils";
import { generateJSON, isAIConfigured } from "./claude";

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
  cityCol: number;
  stateCol: number;
  zipCol: number;
  utilityBillCol: number;
  emailCols: number[];
  phoneCols: PhoneCol[];
  /** Extra useful columns (gender, age, marital, net worth, …) for notes. */
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
    "cityCol", "stateCol", "zipCol", "utilityBillCol", "emailCols", "phoneCols", "extras",
  ],
} as const;

const SYSTEM =
  "You map spreadsheet columns to a CRM lead schema. You are given the first rows " +
  "of a CSV (as JSON arrays of cell strings). The file may or may not have a header " +
  "row. Return ONLY the requested JSON. Use 0-based column indices, and -1 for any " +
  "field that is not present. Identify EVERY phone-number column (in priority order) " +
  "and, for each, the index of an adjacent Do-Not-Call/status column if one exists " +
  "(else -1). List all email columns. Put other useful person data (gender, age or " +
  "date of birth, marital status, net worth, income, occupation, owner type, mailing " +
  "address) into `extras` with a short human label for each. Never guess a column " +
  "that isn't clearly that field.";

/** Build a compact, token-bounded sample of the grid for the model. */
function sampleFor(grid: string[][]): string {
  const rows = grid.slice(0, 12).map((r) => r.map((c) => (c ?? "").slice(0, 50)));
  const colCount = grid.reduce((m, r) => Math.max(m, r.length), 0);
  return `Columns: ${colCount}. Rows (each is an array of cells, index 0..${colCount - 1}):\n${JSON.stringify(rows)}`;
}

async function inferColumns(grid: string[][]): Promise<ColumnMapping> {
  return generateJSON<ColumnMapping>({
    system: SYSTEM,
    prompt: sampleFor(grid),
    schema: MAPPING_SCHEMA as Record<string, unknown>,
    schemaName: "lead_column_mapping",
    effort: "low",
    maxTokens: 1024,
  });
}

const cell = (row: string[], i: number) =>
  i >= 0 && i < row.length ? (row[i] ?? "").trim() : "";

const isDnc = (v: string) => /do\s*not\s*call|dnc|opt(ed)?\s*out/i.test(v);

/** Apply an inferred mapping to every data row. */
function applyMapping(grid: string[][], m: ColumnMapping): ParseResult {
  const start = m.hasHeader ? 1 : 0;
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
      .map((p) => ({
        raw: cell(row, p.numberCol),
        e164: normalizePhone(cell(row, p.numberCol)),
        dnc: p.dncCol >= 0 && isDnc(cell(row, p.dncCol)),
      }))
      .filter((p) => p.raw);
    const callable = phones.filter((p) => p.e164 && !p.dnc);
    const anyValid = phones.filter((p) => p.e164);
    const primary = callable[0] ?? anyValid[0] ?? phones[0];
    const phone = primary ? primary.e164 || primary.raw : "";

    const emails = m.emailCols.map((i) => cell(row, i)).filter(Boolean);

    // Everything else we can't store as a first-class column is preserved in
    // notes so no information from the CSV is lost.
    const noteParts: string[] = [];
    for (const ex of m.extras) {
      const v = cell(row, ex.col);
      if (v) noteParts.push(`${ex.label}: ${v}`);
    }
    const otherPhones = anyValid.filter((p) => p.e164 !== phone).map((p) => p.e164);
    if (otherPhones.length) noteParts.push(`Other numbers: ${otherPhones.join(", ")}`);
    if (emails.length > 1) noteParts.push(`Other emails: ${emails.slice(1).join(", ")}`);
    if (phones.some((p) => p.dnc)) noteParts.push("Some numbers flagged Do Not Call");

    const billRaw = cell(row, m.utilityBillCol).replace(/[^0-9.]/g, "");
    const bill = billRaw ? Number(billRaw) : NaN;

    const lead: ParsedLead = {
      firstName,
      lastName,
      phone,
      email: emails[0] || undefined,
      address: cell(row, m.addressCol) || undefined,
      city: cell(row, m.cityCol) || undefined,
      state: cell(row, m.stateCol) || undefined,
      zip: cell(row, m.zipCol) || undefined,
      notes: noteParts.join("; ") || undefined,
    };
    if (!Number.isNaN(bill) && bill > 0) lead.utilityBill = bill;

    if (!lead.phone && !firstName && !lastName) continue;
    if (lead.phone && !isValidPhone(lead.phone)) noPhone++;
    out.push(lead);
  }

  return { leads: out, noPhone, sawPhoneColumn: m.phoneCols.length > 0 };
}

/** True when Claude can be used to parse leads. */
export const canAIParse = isAIConfigured;

/** Infer the schema with Claude and extract every lead. Throws if AI is off. */
export async function aiParseLeads(grid: string[][]): Promise<ParseResult> {
  const mapping = await inferColumns(grid);
  return applyMapping(grid, mapping);
}
