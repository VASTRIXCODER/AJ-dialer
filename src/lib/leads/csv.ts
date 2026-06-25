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
};

export type ParseResult = {
  leads: ParsedLead[];
  /** Rows that had data but no dialable phone number. */
  noPhone: number;
  /** Whether any column mapped to a phone at all (catches bad delimiters). */
  sawPhoneColumn: boolean;
};

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

type Field = keyof ParsedLead | "name" | null;

/**
 * Map a column header to a lead field. Phone is checked FIRST and matches a wide
 * range of names so a customer's column never silently fails to map.
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
    n === "customername" || n === "contact" || n === "contactname" || n === "leadname"
  )
    return "name";
  if (n.includes("email") || n === "mail") return "email";
  if (n.includes("street") || n === "address" || n === "address1" || n === "streetaddress" || n.includes("addr"))
    return "address";
  if (n === "city" || n === "town") return "city";
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

/** Deterministic header-based mapping (fast path for well-formed CSVs). */
export function rowsToLeads(grid: string[][]): ParseResult {
  if (grid.length < 2) return { leads: [], noPhone: 0, sawPhoneColumn: false };
  const header = grid[0].map(mapHeader);
  if (!header.includes("phone")) {
    const sniffed = sniffPhoneColumn(grid, header);
    if (sniffed >= 0) header[sniffed] = "phone";
  }
  const sawPhoneColumn = header.includes("phone");
  const out: ParsedLead[] = [];
  let noPhone = 0;
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const lead: ParsedLead = { firstName: "", lastName: "", phone: "" };
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
      } else {
        lead[key] = val;
      }
    });
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
  return { leads: out, noPhone, sawPhoneColumn: sawPhoneColumn || recoveredAny };
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
