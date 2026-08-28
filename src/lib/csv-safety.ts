// ─────────────────────────────────────────────────────────────────────────────
// CSV output safety — THE shared cell encoder for every CSV this app produces.
//
// Lead data originates in customer-supplied spreadsheets we never controlled, so
// anything we write back out must be neutralized against CSV/formula injection
// (Excel and Google Sheets execute cells starting with = + - @ as formulas).
// This module used to live inline in /api/leads/export; the report export
// shipped without it — every exporter now imports from here so a new export
// path can't silently regress.
// ─────────────────────────────────────────────────────────────────────────────

/** Leading characters Excel/Sheets treat as the start of a formula. */
export const FORMULA_LEAD = /^[=@+\-\t\r]/;

/** Phones ("+14155551234") and negative numbers legitimately start with + or -.
 *  Only guard values that AREN'T plain numeric/phone shapes, so a real phone
 *  isn't mangled into "'+1415..." for every single row. */
export const NUMERIC_ISH = /^[+-]?[\d\s().-]+$/;

/** Encode one CSV cell: formula-lead neutralization + RFC-4180 quoting. */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (FORMULA_LEAD.test(s) && !NUMERIC_ISH.test(s)) s = `'${s}`;
  // Quote when the value contains a delimiter, a quote, a newline, or edge
  // whitespace that a parser would otherwise trim.
  if (/[",\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One encoded CSV row. */
export function csvLine(cells: readonly unknown[], delimiter = ","): string {
  return cells.map(csvCell).join(delimiter);
}

/** UTF-8 BOM — Excel misreads accented names without it. Prepend to file text. */
export const CSV_BOM = "﻿";

/** RFC-4180 line ending. */
export const CSV_EOL = "\r\n";
