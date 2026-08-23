import {
  detectFieldType,
  normalizeFieldKey,
  parseFieldValue,
  RESERVED_FIELD_KEYS,
  type LeadFieldDef,
  type LeadFieldType,
} from "./field-schema";
import { isValidPhone, normalizePhone } from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// Pure CSV parsing + deterministic column mapping for lead import.
// No DOM / no server-only deps, so it runs identically on the client (instant
// preview) and the server (the AI-assisted import route). The AI path in
// ../ai/parse-leads.ts handles formats this deterministic mapper can't.
// ─────────────────────────────────────────────────────────────────────────────

export type ParsedLead = {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  utilityProvider?: string;
  solarProvider?: string;
  utilityBill?: number;
  solarPayment?: number;
  notes?: string;
  /** Typed spillover for CSV columns beyond the core slots (custom_fields jsonb). */
  customFields?: Record<string, string | number | boolean>;
};

export type ParseResult = {
  leads: ParsedLead[];
  /** Rows that had data but no dialable phone number. */
  noPhone: number;
  /** Whether any column mapped to a phone at all (catches bad delimiters). */
  sawPhoneColumn: boolean;
  /** Typed defs for every unmapped column captured into customFields. */
  discoveredFields: LeadFieldDef[];
};

/** Custom fields captured per import are capped so a 200-column broker export
 *  can't balloon every lead row's jsonb (and the org's field schema). */
export const MAX_CUSTOM_FIELDS = 30;

/** Detect the most likely delimiter from the header line (comma/semicolon/tab/pipe). */
export function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** RFC-4180-ish parser that honors a chosen delimiter (handles quotes + escapes). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length));
}

/** Parse a spreadsheet into a grid, auto-detecting delimiter and stripping BOM. */
export function parseSheet(raw: string): string[][] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const nl = text.indexOf("\n");
  const firstLine = nl === -1 ? text : text.slice(0, nl);
  return parseDelimited(text, detectDelimiter(firstLine));
}

/** How many significant digits a cell holds (10+ ⇒ looks like a phone number). */
export function digitCount(v: string): number {
  return v.replace(/\D/g, "").length;
}

// customFields is excluded: no header maps to it directly — unmapped columns
// are captured into it by key instead (see discoverCustomColumns).
export type Field =
  | Exclude<keyof ParsedLead, "customFields">
  | "name"
  | "address2"
  | null;

/**
 * Map a column header to a lead field. Phone is checked FIRST and matches a wide
 * range of names so a customer's column never silently fails to map. Address is
 * matched generously — line 1, line 2, unit/apt/suite, and combined "full /
 * mailing / property / service address" columns are all captured, and line 2 is
 * checked BEFORE the generic address so it isn't swallowed.
 */
export function mapHeader(h: string): Field {
  const n = h.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n) return null;
  if (
    n.includes("phone") || n.includes("mobile") || n.includes("cell") ||
    n.includes("telephone") || n === "tel" || n === "ph" || n === "phno" ||
    n === "number" || n === "msisdn" || n.includes("contactnumber") ||
    n.includes("contactno") || n.includes("phonenumber") || n.includes("wireless")
  )
    return "phone";
  if (n.includes("firstname") || n === "first" || n === "fname" || n === "givenname")
    return "firstName";
  if (n.includes("lastname") || n === "last" || n === "lname" || n === "surname" || n === "familyname")
    return "lastName";
  if (
    n === "name" || n === "fullname" || n === "homeowner" || n === "customer" ||
    n === "customername" || n === "contact" || n === "contactname" || n === "leadname" ||
    n === "owner" || n === "ownername" || n === "resident"
  )
    return "name";
  if (n.includes("email") || n === "mail") return "email";
  // Secondary address line / unit — must come BEFORE the generic address match.
  if (
    n === "address2" || n === "addr2" || n === "addressline2" ||
    n === "line2" || n === "addr2line" || n === "unit" || n === "unitnumber" ||
    n === "unitno" || n === "apt" || n === "apartment" || n === "aptnumber" ||
    n === "aptno" || n === "suite" || n === "ste" || n === "secondaryaddress"
  )
    return "address2";
  // Primary street address — line 1 or a combined/full address column.
  if (
    n.includes("street") || n === "address" || n === "address1" ||
    n === "addressline1" || n === "line1" || n.includes("streetaddress") ||
    n.includes("propertyaddress") || n.includes("mailingaddress") ||
    n.includes("serviceaddress") || n.includes("siteaddress") ||
    n.includes("homeaddress") || n.includes("fulladdress") ||
    n === "house" || n === "housenumber" || n.includes("addr")
  )
    return "address";
  if (n === "city" || n === "town" || n === "municipality") return "city";
  if (n === "state" || n === "st" || n.includes("province") || n === "region") return "state";
  if (n.includes("zip") || n.includes("postal") || n === "postcode") return "zip";
  if (
    (n.includes("utility") || n.includes("electric") || n.includes("power")) &&
    (n.includes("bill") || n.includes("amount") || n.includes("cost"))
  )
    return "utilityBill";
  if (n.includes("solar") && (n.includes("payment") || n.includes("pmt") || n.includes("loan") || n.includes("lease")))
    return "solarPayment";
  if (n.includes("utility") || n === "provider") return "utilityProvider";
  if (n.includes("solar")) return "solarProvider";
  if (n.includes("note") || n.includes("comment") || n.includes("remark")) return "notes";
  return null;
}

/**
 * Is this cell plausibly a PHONE number (vs. a value that merely has ~10 digits)?
 * Crucial for recovery: a money band like "$50,000-74,999" strips to 5000074999
 * (10 digits) and would otherwise be mistaken for a phone. We reject money,
 * percentages, thousands-grouped numbers, numeric ranges, and dates BEFORE the
 * E.164 check — while still accepting formatted phones like "(214) 403-9949".
 */
export function looksLikePhone(raw: string): boolean {
  const t = (raw ?? "").trim();
  if (!t) return false;
  if (/[$%,]/.test(t)) return false; // money / percent / thousands separators
  if (/\d{4,}\s*[-–]\s*\d{4,}/.test(t)) return false; // range of two big numbers
  if (/^\d{1,2}\/\d{1,4}(\/\d{2,4})?$/.test(t)) return false; // dates (07/1958, 1/2/85)
  return isValidPhone(t);
}

/**
 * Universal per-row phone recovery: scan every cell in a row and return the
 * first one that genuinely looks like a phone (normalized to E.164). The safety
 * net that makes extraction robust regardless of column mapping — if a phone
 * exists ANYWHERE in the row, we find it, while ignoring IDs, ZIPs, dates, and
 * money. An optional skip set excludes columns already consumed.
 */
export function recoverPhone(cells: string[], skip?: Set<number>): string {
  for (let c = 0; c < cells.length; c++) {
    if (skip?.has(c)) continue;
    const v = (cells[c] ?? "").trim();
    if (looksLikePhone(v)) return normalizePhone(v);
  }
  return "";
}

/**
 * Find the phone column from the data when no header mapped one. Scores each
 * unmapped column by how many of its values are VALID phone numbers (not merely
 * 10+ digits) — so data-broker ID columns (12–13 digits) and ZIPs (5 digits)
 * are rejected, and the real 10/11-digit phone column wins.
 */
function sniffPhoneColumn(grid: string[][], header: Field[]): number {
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const limit = Math.min(grid.length, 80); // sample enough rows to be confident
  let best = -1;
  let bestHits = 0;
  for (let c = 0; c < width; c++) {
    if (header[c]) continue; // don't steal an already-mapped column
    let hits = 0;
    let seen = 0;
    for (let r = 1; r < limit; r++) {
      const v = (grid[r]?.[c] ?? "").trim();
      if (!v) continue;
      seen++;
      if (looksLikePhone(v)) hits++;
    }
    if (seen > 0 && hits / seen >= 0.5 && hits > bestHits) {
      bestHits = hits;
      best = c;
    }
  }
  return best;
}

/** A column earmarked for customFields capture, with its detected type. */
export type CustomCapture = {
  col: number;
  key: string;
  label: string;
  type: LeadFieldType;
};

/** Non-empty values of one column (data rows only), enough for type detection. */
export function sampleColumn(grid: string[][], col: number, start = 1): string[] {
  const samples: string[] = [];
  for (let r = start; r < grid.length; r++) {
    const v = (grid[r]?.[col] ?? "").trim();
    if (!v) continue;
    samples.push(v);
    if (samples.length >= 200) break; // detectFieldType samples at most 200
  }
  return samples;
}

/**
 * Earmark every column the header mapper DIDN'T claim for customFields capture:
 * normalize its header to a snake_case key, detect its type from the column's
 * values, and skip anything unusable — empty headers, keys that collide with an
 * earlier column, and columns with no data at all. Capped at MAX_CUSTOM_FIELDS.
 */
function discoverCustomColumns(grid: string[][], header: Field[]): CustomCapture[] {
  const captures: CustomCapture[] = [];
  const seen = new Set<string>();
  for (let c = 0; c < grid[0].length && captures.length < MAX_CUSTOM_FIELDS; c++) {
    if (header[c]) continue; // an already-mapped core column
    const label = (grid[0][c] ?? "").trim();
    if (!label) continue; // headerless column — no key to store it under
    const key = normalizeFieldKey(label);
    if (!key || seen.has(key)) continue;
    // Never capture reserved keys: the export's metadata tail (Status, AI
    // Score, Created At…) would otherwise re-import as junk custom fields
    // holding stale shadows of live columns.
    if (RESERVED_FIELD_KEYS.has(key)) continue;
    const samples = sampleColumn(grid, c);
    if (!samples.length) continue; // entirely empty column — nothing to keep
    seen.add(key);
    captures.push({ col: c, key, label, type: detectFieldType(samples) });
  }
  return captures;
}

/** The LeadFieldDef a capture contributes to the org's schema. Visibility is
 *  decided at persist time (see mergeDiscoveredLeadFields), not here. */
export function captureToFieldDef(cap: {
  key: string;
  label: string;
  type: LeadFieldType;
}): LeadFieldDef {
  return {
    key: cap.key,
    label: cap.label,
    type: cap.type,
    source: "custom",
    showInTable: false,
    showInQualify: false,
  };
}

/**
 * Which column is which, plus the typed customFields captures — resolved ONCE
 * per upload and reused for every chunk of it.
 *
 * Both halves sample the DATA, not just the header row (sniffPhoneColumn scores
 * columns by how many values are real phone numbers; detectFieldType reads a
 * column's values). Re-resolving per chunk would therefore let a big upload
 * disagree with itself — chunk 1 typing a column "number" and chunk 7 typing the
 * same column "text", or one chunk sniffing a phone column another one misses.
 * Resolve on the first chunk, carry the plan, and every row of the file is read
 * the same way.
 */
export interface HeaderPlan {
  header: Field[];
  captures: CustomCapture[];
}

/** Work out this file's column layout from its header row + a sample of its data. */
export function resolveHeaderPlan(grid: string[][]): HeaderPlan {
  if (!grid.length) return { header: [], captures: [] };
  const header = grid[0].map(mapHeader);
  if (!header.includes("phone")) {
    const sniffed = sniffPhoneColumn(grid, header);
    if (sniffed >= 0) header[sniffed] = "phone";
  }
  // Capture is decided AFTER phone sniffing so a data-detected phone column is
  // never duplicated into customFields.
  return { header, captures: discoverCustomColumns(grid, header) };
}

/**
 * Deterministic header-based mapping (fast path for well-formed CSVs).
 * Pass the `plan` resolved from the first chunk to read later chunks of the same
 * upload identically — see HeaderPlan.
 */
export function rowsToLeads(grid: string[][], plan?: HeaderPlan): ParseResult {
  if (grid.length < 2)
    return { leads: [], noPhone: 0, sawPhoneColumn: false, discoveredFields: [] };
  const { header, captures } = plan ?? resolveHeaderPlan(grid);
  const sawPhoneColumn = header.includes("phone");
  const out: ParsedLead[] = [];
  let noPhone = 0;
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const lead: ParsedLead = { firstName: "", lastName: "", phone: "" };
    let addr1 = "";
    let addr2 = "";
    header.forEach((key, c) => {
      const val = (cells[c] ?? "").trim();
      if (!key || !val) return;
      if (key === "name") {
        const parts = val.split(/\s+/);
        lead.firstName = lead.firstName || parts[0] || "";
        lead.lastName = lead.lastName || parts.slice(1).join(" ");
      } else if (key === "utilityBill" || key === "solarPayment") {
        const num = Number(val.replace(/[^0-9.]/g, ""));
        if (!Number.isNaN(num) && num > 0) lead[key] = num;
      } else if (key === "phone") {
        // Only accept a genuine phone here; a mis-mapped column (carrier, money)
        // falls through to per-row recovery below.
        lead.phone = looksLikePhone(val) ? normalizePhone(val) : "";
      } else if (key === "address") {
        // Multiple address columns are concatenated, not overwritten, so a split
        // "street" + "address" never drops half the address.
        addr1 = addr1 && addr1 !== val ? `${addr1}, ${val}` : val;
      } else if (key === "address2") {
        addr2 = addr2 && addr2 !== val ? `${addr2}, ${val}` : val;
      } else {
        lead[key] = val;
      }
    });
    // Combine the full street address (line 1 + unit / line 2) so nothing is lost.
    const fullAddr = [addr1, addr2].filter(Boolean).join(", ");
    if (fullAddr) lead.address = fullAddr;
    // Every unmapped column's cell lands in customFields, coerced to the
    // column's detected type — nothing a CSV carries is silently dropped.
    for (const cap of captures) {
      const raw = (cells[cap.col] ?? "").trim();
      if (!raw) continue;
      (lead.customFields ??= {})[cap.key] = parseFieldValue(raw, cap.type);
    }
    // Guarantee a dialable phone if one exists ANYWHERE in the row — covers
    // mis-mapped/missing phone columns and headerless broker exports.
    if (!isValidPhone(lead.phone)) {
      const recovered = recoverPhone(cells);
      if (recovered) lead.phone = recovered;
    }
    const hasName = Boolean(lead.firstName || lead.lastName);
    if (!lead.phone && !hasName) continue;
    if (!isValidPhone(lead.phone)) noPhone++;
    out.push(lead);
  }
  // We "saw" phones if a column mapped OR recovery found dialable numbers.
  const recoveredAny = out.some((l) => isValidPhone(l.phone));
  return {
    leads: out,
    noPhone,
    sawPhoneColumn: sawPhoneColumn || recoveredAny,
    discoveredFields: captures.map(captureToFieldDef),
  };
}

/**
 * Did the deterministic pass clearly understand this file? We trust it only when
 * it found a phone column AND a name for most rows. A headerless broker export
 * fails this test (names never map) and is routed to the AI parser instead.
 */
export function isConfident(result: ParseResult): boolean {
  if (!result.sawPhoneColumn || result.leads.length === 0) return false;
  const named = result.leads.filter((l) => l.firstName || l.lastName).length;
  const dialable = result.leads.filter((l) => isValidPhone(l.phone)).length;
  return named / result.leads.length >= 0.5 && dialable / result.leads.length >= 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovered-field plumbing: validating field defs that arrive over the wire
// (the sort-preview → `rows` re-import round trip) and merging new discoveries
// into an org's saved schema. Pure, so both are unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_TYPES = new Set<LeadFieldType>([
  "text", "number", "currency", "boolean", "date", "phone", "email", "url",
]);

/** How many custom fields may default to a table column (matches the table's
 *  visible-custom-column cap, so settings stay coherent with what renders). */
export const MAX_TABLE_CUSTOM_FIELDS = 4;

/**
 * Validate client-supplied discovered-field defs (the `rows` import path gets
 * them as JSON from the sort-preview round trip — never trust them as-is).
 * Keys are re-normalized, labels trimmed and bounded, unknown types dropped,
 * source forced to "custom", and the per-import cap re-applied.
 */
export function sanitizeDiscoveredFields(raw: unknown): LeadFieldDef[] {
  if (!Array.isArray(raw)) return [];
  const out: LeadFieldDef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_CUSTOM_FIELDS) break;
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const key = String(f.key ?? "");
    // REJECT (never silently rename) keys that aren't already normalized:
    // renaming here would register the def under a different key than the one
    // the round-tripped row values carry — a permanent def/value mismatch.
    if (!key || key !== normalizeFieldKey(key) || seen.has(key)) continue;
    if (RESERVED_FIELD_KEYS.has(key)) continue;
    const type = String(f.type ?? "") as LeadFieldType;
    if (!FIELD_TYPES.has(type)) continue;
    const label = String(f.label ?? "").trim().slice(0, 80) || key;
    seen.add(key);
    out.push(captureToFieldDef({ key, label, type }));
  }
  return out;
}

/**
 * Merge newly discovered fields into an org's saved schema. Existing defs are
 * NEVER touched (an admin's relabel/retype always survives a re-import) and
 * keys are never duplicated. New fields default to visible in the leads table
 * until MAX_TABLE_CUSTOM_FIELDS custom columns are shown org-wide, and never
 * default into the qualify panel.
 */
export function mergeDiscoveredLeadFields(
  existing: LeadFieldDef[],
  discovered: LeadFieldDef[],
): { fields: LeadFieldDef[]; added: number } {
  const known = new Set(existing.map((f) => f.key));
  let visible = existing.filter((f) => f.source === "custom" && f.showInTable).length;
  const added: LeadFieldDef[] = [];
  for (const def of discovered) {
    if (known.has(def.key)) continue; // never overwrite an existing def
    known.add(def.key);
    const showInTable = visible < MAX_TABLE_CUSTOM_FIELDS;
    if (showInTable) visible++;
    added.push({ ...def, source: "custom", showInTable, showInQualify: false });
  }
  return { fields: added.length ? [...existing, ...added] : existing, added: added.length };
}
