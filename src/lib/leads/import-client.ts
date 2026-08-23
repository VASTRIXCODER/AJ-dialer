import { splitCsvIntoChunks } from "./chunk";

// ─────────────────────────────────────────────────────────────────────────────
// Browser side of a lead import.
//
// One uploaded file becomes one or more /api/leads/import requests, sent IN
// ORDER, and their counts are added up into a single honest total. Everything
// here exists to make "the whole file landed" true and checkable:
//
//   • The file is cut on record boundaries, so no row is ever half-sent and no
//     row is left out. The old importer sent one request and the server threw
//     away everything past row 5,000 without saying so.
//   • Chunks run SEQUENTIALLY, not in parallel. Duplicate detection compares
//     each batch against the leads already in the org, so two chunks in flight
//     at once would both look at a pre-import table and both insert the same
//     repeated number. Sequential also keeps the dial queue in file order.
//   • The column layout resolved on chunk 1 (`columnPlan`) rides along on the
//     rest, so the model is consulted once per FILE, not once per request — and
//     every chunk reads the file the same way.
//   • `parsedRows` comes back from every chunk, so the caller can compare what
//     the server read against what the file contained rather than trusting a
//     bare "success".
// ─────────────────────────────────────────────────────────────────────────────

/** Rows per request. Comfortably inside the function's time budget. */
const CHUNK_ROWS = 4000;
/** Bytes per request, under both the route's own cap and the platform's. */
const CHUNK_BYTES = 3_000_000;

export interface ImportTotals {
  inserted: number;
  invalidPhone: number;
  duplicates: number;
  dncSkipped: number;
  /** Data rows the file contained, across all chunks. The denominator. */
  fileRows: number;
  /** Rows the server turned into a lead. */
  parsedRows: number;
  /** Rows with neither a phone nor a name — nothing to dial, nobody to ask for. */
  skippedRows: number;
  /** Rows a chunk had to leave behind. Must be 0; surfaced loudly if not. */
  truncated: number;
  packs: number;
  /** "ai" when Claude's column mapping beat the header mapper on this file. */
  source: "headers" | "ai" | "rows" | null;
  aiError: string | null;
  chunks: number;
  chunksSent: number;
}

export type ImportOutcome =
  | { ok: true; totals: ImportTotals }
  | {
      ok: false;
      error: string;
      /** The import is blocked on a compliance certification, not broken. */
      certificationRequired?: boolean;
      campaignId?: string | null;
      /** What landed before the failure — never report 0 for rows that exist. */
      totals: ImportTotals;
    };

function emptyTotals(chunks: number): ImportTotals {
  return {
    inserted: 0,
    invalidPhone: 0,
    duplicates: 0,
    dncSkipped: 0,
    fileRows: 0,
    parsedRows: 0,
    skippedRows: 0,
    truncated: 0,
    packs: 0,
    source: null,
    aiError: null,
    chunks,
    chunksSent: 0,
  };
}

const num = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);

/**
 * Import one CSV, chunking it if it's big. `base` carries the per-import options
 * (campaign, lead group, packs) exactly as the route expects them — including the
 * distinction between an omitted `leadGroup` and an explicit null, which the
 * caller preserves by building the object itself.
 */
export async function importCsvInChunks(
  csv: string,
  base: Record<string, unknown> = {},
  onProgress?: (sent: number, total: number) => void,
): Promise<ImportOutcome> {
  const chunks = splitCsvIntoChunks(csv, {
    maxRows: CHUNK_ROWS,
    maxBytes: CHUNK_BYTES,
  });
  if (!chunks.length) {
    return {
      ok: false,
      error: "That file has no data rows under the first line.",
      totals: emptyTotals(0),
    };
  }

  const totals = emptyTotals(chunks.length);
  let columnPlan: unknown = null;
  let packSeqOffset = 0;

  for (const chunk of chunks) {
    onProgress?.(totals.chunksSent, chunks.length);

    const res = await fetch("/api/leads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...base,
        csv: chunk.csv,
        rowOffset: chunk.rowOffset,
        ...(columnPlan ? { columnPlan } : {}),
        ...(packSeqOffset ? { packSeqOffset } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (json.certificationRequired) {
      return {
        ok: false,
        error: String(json.error ?? "This campaign needs a compliance certification."),
        certificationRequired: true,
        campaignId: (json.campaignId as string | null) ?? null,
        totals,
      };
    }
    if (!res.ok || json.error) {
      // Partial totals ride along: rows already inserted are in the table, and
      // telling the importer "0" is what makes them re-upload and double the list.
      return {
        ok: false,
        error: String(json.error ?? "Import failed."),
        totals,
      };
    }

    totals.inserted += num(json.inserted);
    totals.invalidPhone += num(json.invalidPhone);
    totals.duplicates += num(json.duplicates);
    totals.dncSkipped += num(json.dncSkipped);
    totals.fileRows += num(json.fileRows);
    totals.parsedRows += num(json.parsedRows);
    totals.skippedRows += num(json.skippedRows);
    totals.truncated += num(json.truncated);
    totals.packs += num(json.packs);
    totals.chunksSent += 1;
    // The first chunk decides how the file is read, and reports whether the
    // model or the header mapper won it; later chunks just replay that.
    if (totals.source === null) {
      totals.source = (json.source as ImportTotals["source"]) ?? null;
      totals.aiError = (json.aiError as string | null) ?? null;
      if (json.columnPlan) columnPlan = json.columnPlan;
    }
    packSeqOffset += num(json.packs);
  }

  onProgress?.(totals.chunksSent, chunks.length);
  return { ok: true, totals };
}

/** The one-line result an importer shows when the upload finishes. */
export function describeImport(totals: ImportTotals): string {
  const notes = [
    totals.invalidPhone > 0
      ? `${totals.invalidPhone} without a valid phone — not dialable`
      : "",
    totals.duplicates > 0
      ? `${totals.duplicates} already in your org's leads — skipped`
      : "",
    totals.dncSkipped > 0 ? `${totals.dncSkipped} on your Do-Not-Call list` : "",
    totals.skippedRows > 0
      ? `${totals.skippedRows} rows had no phone and no name`
      : "",
  ].filter(Boolean);
  const skipNote = notes.length ? ` (${notes.join("; ")})` : "";
  const how = totals.source === "ai" ? " — columns mapped by AI" : "";
  const packNote =
    totals.packs > 0 ? ` · ${totals.packs} pack${totals.packs === 1 ? "" : "s"}` : "";
  return `Imported ${totals.inserted} leads${skipNote}${how}${packNote}.`;
}

/**
 * Anything the importer must NOT let pass as a clean success. Returns a warning
 * string, or null when every row of the file is accounted for.
 *
 * The books have to balance: every data row in the file ends up inserted, or
 * skipped as a duplicate, or scrubbed as DNC, or discarded for having no phone
 * and no name. A row that fits none of those is unexplained — and an unexplained
 * row is the exact failure this whole change exists to remove: a lead that was in
 * the customer's file, isn't in the product, and nobody was ever told.
 */
export function importShortfall(totals: ImportTotals): string | null {
  if (totals.truncated > 0) {
    return `${totals.truncated} rows were left out because the upload hit a size limit — split the file and import the rest.`;
  }
  const accounted =
    totals.inserted + totals.duplicates + totals.dncSkipped + totals.skippedRows;
  if (totals.fileRows > accounted) {
    const missing = totals.fileRows - accounted;
    return `${missing} of ${totals.fileRows} rows didn't import — re-upload the file to try them again.`;
  }
  return null;
}
