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

/** Find the phone column from the data when no header mapped one. */
function sniffPhoneColumn(grid: string[][], header: Field[]): number {
  const width = header.length;
  let best = -1;
  let bestHits = 0;
  for (let c = 0; c < width; c++) {
    if (header[c]) continue;
    let hits = 0;
    let seen = 0;
    for (let r = 1; r < grid.length; r++) {
      const v = (grid[r][c] ?? "").trim();
      if (!v) continue;
      seen++;
      if (digitCount(v) >= 10 && digitCount(v) <= 15) hits++;
    }
    if (seen > 0 && hits >= bestHits && hits / seen >= 0.5 && hits > 0) {
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
        lead.phone = normalizePhone(val) || val;
      } else {
        lead[key] = val;
      }
    });
    const hasName = Boolean(lead.firstName || lead.lastName);
    if (!lead.phone && !hasName) continue;
    if (lead.phone && !isValidPhone(lead.phone)) noPhone++;
    out.push(lead);
  }
  return { leads: out, noPhone, sawPhoneColumn };
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
