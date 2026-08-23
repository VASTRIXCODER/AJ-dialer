import { detectDelimiter } from "./csv";

// ─────────────────────────────────────────────────────────────────────────────
// Splitting one uploaded CSV into several import requests.
//
// WHY THIS EXISTS. A single import POST is bounded from two directions that have
// nothing to do with each other: the serverless request-body limit (a few MB, set
// by the platform, not by us) and how much work one invocation can do inside its
// timeout. The importer used to meet both by silently discarding everything past
// the first 5,000 rows — a 9,381-row customer file reported "Imported 5000 leads"
// and 4,381 homeowners simply never existed. Truncation must never be the answer.
//
// So the client cuts the file into whole-record chunks instead, each carrying a
// copy of the header row, and imports them in order. Every row is sent; nothing
// is dropped; each chunk is a normal, well-formed CSV that the existing parser
// reads without knowing it was ever part of a bigger file.
//
// Splitting is done on RECORD boundaries, tracking quote state — a quoted field
// may legally contain a newline ("123 Main St\nApt 4"), and cutting there would
// corrupt two rows and shift every column after it.
// ─────────────────────────────────────────────────────────────────────────────

export interface CsvChunk {
  /** A complete CSV: this upload's header row plus this chunk's data rows. */
  csv: string;
  /** 0-based index of this chunk's first data row WITHIN THE WHOLE FILE. */
  rowOffset: number;
  /** How many data rows this chunk carries. */
  rows: number;
}

export interface ChunkOptions {
  /** Max data rows per chunk. */
  maxRows: number;
  /** Max UTF-8 bytes per chunk, header included. */
  maxBytes: number;
}

/**
 * UTF-8 byte length without allocating an encoder or a copy of the string. The
 * budget that matters is what goes on the wire, and `String.length` counts UTF-16
 * code units — which UNDER-counts every non-ASCII character and would happily
 * build a chunk over the limit for a file full of accented names.
 */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++; // surrogate pair — one code point, two units
    } else n += 3;
  }
  return n;
}

/**
 * Cut `raw` into its records (the header first), respecting quoted newlines.
 * Blank lines are dropped, matching parseDelimited's own "a row with nothing in
 * it isn't a row" rule, so chunk row counts line up with parsed row counts.
 */
export function splitRecords(raw: string, delimiter: string): string[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const records: string[] = [];
  let start = 0;
  let inQuotes = false;
  const push = (end: number) => {
    const rec = text.slice(start, end);
    // A record is empty when every field is blank — "a,,b" is real, ",," is not.
    if (rec.split(delimiter).some((c) => c.trim().length)) records.push(rec);
    start = end + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Doubled quotes inside a quoted field are an escaped quote, not a close.
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (ch === "\n" && !inQuotes) push(i);
  }
  if (start < text.length) push(text.length);
  return records;
}

/**
 * Split a CSV into chunks that each stay under both budgets.
 *
 * A single record larger than `maxBytes` still gets a chunk of its own: the
 * budget is a target, dropping the row is not an option. A file that already fits
 * comes back as exactly one chunk, byte-identical in content to the input, so the
 * common case pays nothing for this machinery.
 */
export function splitCsvIntoChunks(raw: string, opts: ChunkOptions): CsvChunk[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const nl = text.indexOf("\n");
  const delimiter = detectDelimiter(nl === -1 ? text : text.slice(0, nl));
  const records = splitRecords(text, delimiter);
  if (records.length < 2) return [];

  const header = records[0];
  const headerBytes = utf8Length(header) + 1;
  const maxRows = Math.max(1, Math.floor(opts.maxRows));
  const maxBytes = Math.max(headerBytes + 1, Math.floor(opts.maxBytes));

  const chunks: CsvChunk[] = [];
  let batch: string[] = [];
  let batchBytes = headerBytes;
  let rowOffset = 0;

  const flush = () => {
    if (!batch.length) return;
    chunks.push({
      csv: `${header}\n${batch.join("\n")}`,
      rowOffset,
      rows: batch.length,
    });
    rowOffset += batch.length;
    batch = [];
    batchBytes = headerBytes;
  };

  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    const bytes = utf8Length(rec) + 1;
    // Close the current chunk BEFORE adding a row that would overflow it — but
    // never emit an empty chunk, which is what a single oversized row would do.
    if (batch.length && (batch.length >= maxRows || batchBytes + bytes > maxBytes)) {
      flush();
    }
    batch.push(rec);
    batchBytes += bytes;
  }
  flush();
  return chunks;
}
