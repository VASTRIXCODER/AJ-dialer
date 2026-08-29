import "server-only";

import type { DialingPreference } from "../leads/csv";
import { countyForZip } from "../leads/zip-county";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { count } from "../telemetry";
import { normalizePhone } from "../utils";
import { addManyToDnc } from "./dnc";
import type { LeadInput } from "./leads";

// ─────────────────────────────────────────────────────────────────────────────
// Import jobs — the observable, rollbackable write path behind the Import
// Studio (/leads/import).
//
// WHY THIS EXISTS. The legacy insertLeads dedupe re-read EVERY phone in the org
// for EVERY chunk (O(book × chunks): a 50k-lead org importing a 40k-row file
// paged 500k rows just to answer "seen this number before?"). writeImportChunk
// replaces that with ONE app_phone_matches probe per chunk: send the chunk's
// last-10-digit keys, get back which already exist and on which lead. That same
// probe result is what makes dedupe MODES possible — skip (today's behavior),
// update (enrich the existing lead), create_new (import everything).
//
// Every row is accounted for on the import_jobs row (created / updated /
// duplicate / dnc / invalid / skipped / failed), chunks bump it atomically
// (app_import_job_bump — chunks arrive as separate requests), and every
// inserted lead is stamped with its provenance (import_job_id, source_file,
// original_row) so a bad file can be rolled back — but ONLY the rows nobody has
// worked: touched leads survive a rollback by design.
// ─────────────────────────────────────────────────────────────────────────────

export type DedupeMode = "skip" | "update" | "create_new";

export const DEDUPE_MODES: DedupeMode[] = ["skip", "update", "create_new"];

export function normalizeDedupeMode(raw: unknown): DedupeMode {
  return DEDUPE_MODES.includes(raw as DedupeMode) ? (raw as DedupeMode) : "skip";
}

export type ImportAction = "create" | "update" | "skip";

/**
 * The dedupe decision for one row, PURE so the whole skip/update/create matrix
 * is unit-testable without a database (tests/import-dedupe.test.ts).
 *
 * - No usable 10-digit key ⇒ create (nothing to dedupe on — same as before).
 * - create_new ⇒ create, always. The uploader explicitly asked for copies.
 * - A number already in the org ⇒ skip or update per the mode.
 * - An in-batch repeat (same file lists a number twice) is a duplicate in both
 *   skip and update modes — the first occurrence already created/updated it.
 *
 * Idempotency falls out of this: retrying a chunk whose rows already landed
 * finds every digit in the probe result and creates NOTHING new (skip/update).
 */
export function decideImportAction(input: {
  digits: string;
  existingLeadId: string | null;
  seenInBatch: boolean;
  mode: DedupeMode;
}): ImportAction {
  if (input.digits.length !== 10) return "create";
  if (input.mode === "create_new") return "create";
  if (input.existingLeadId) return input.mode === "update" ? "update" : "skip";
  if (input.seenInBatch) return "skip";
  return "create";
}

/**
 * May this lead be deleted by a rollback? PURE (tests/rollback-untouched.test.ts).
 * "Provably untouched" means: still status 'new', never contacted, zero dial
 * attempts, and no call/appointment/callback rows reference it. Anything a human
 * or the AI has worked stays — rollback undoes an import, never work.
 */
export function isUntouchedLead(row: {
  status: string;
  lastContactedAt: string | null;
  attemptCount: number | null;
  /** Any call_records / appointments / callbacks referencing this lead. */
  hasActivity: boolean;
}): boolean {
  return (
    row.status === "new" &&
    !row.lastContactedAt &&
    (row.attemptCount ?? 0) === 0 &&
    !row.hasActivity
  );
}

const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);

type Row = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Import job rows
// ─────────────────────────────────────────────────────────────────────────────

export type ImportJobStatus =
  | "running"
  | "completed"
  | "canceled"
  | "failed"
  | "rolled_back";

export interface ImportJob {
  id: string;
  orgId: string;
  createdBy: string | null;
  fileName: string;
  status: ImportJobStatus;
  hasHeader: boolean;
  delimiter: string;
  dedupeMode: DedupeMode;
  destination: Record<string, unknown>;
  rowsTotal: number;
  created: number;
  updated: number;
  duplicates: number;
  dnc: number;
  invalid: number;
  skipped: number;
  failed: number;
  errorRows: { row: number; message: string }[];
  createdAt: string;
  finishedAt: string | null;
  rolledBackAt: string | null;
}

function rowToJob(r: Row): ImportJob {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    createdBy: r.created_by ? String(r.created_by) : null,
    fileName: String(r.file_name ?? ""),
    status: (String(r.status ?? "running") as ImportJobStatus),
    hasHeader: r.has_header !== false,
    delimiter: String(r.delimiter ?? ","),
    dedupeMode: normalizeDedupeMode(r.dedupe_mode),
    destination:
      r.destination && typeof r.destination === "object"
        ? (r.destination as Record<string, unknown>)
        : {},
    rowsTotal: Number(r.rows_total ?? 0),
    created: Number(r.created_ct ?? 0),
    updated: Number(r.updated_ct ?? 0),
    duplicates: Number(r.duplicate_ct ?? 0),
    dnc: Number(r.dnc_ct ?? 0),
    invalid: Number(r.invalid_ct ?? 0),
    skipped: Number(r.skipped_ct ?? 0),
    failed: Number(r.failed_ct ?? 0),
    errorRows: Array.isArray(r.error_rows)
      ? (r.error_rows as { row: number; message: string }[])
      : [],
    createdAt: String(r.created_at ?? ""),
    finishedAt: r.finished_at ? String(r.finished_at) : null,
    rolledBackAt: r.rolled_back_at ? String(r.rolled_back_at) : null,
  };
}

const JOB_COLUMNS =
  "id, org_id, created_by, file_name, status, has_header, delimiter, dedupe_mode, " +
  "destination, rows_total, created_ct, updated_ct, duplicate_ct, dnc_ct, " +
  "invalid_ct, skipped_ct, failed_ct, error_rows, created_at, finished_at, rolled_back_at";

export async function createImportJob(opts: {
  orgId: string;
  createdBy: string | null;
  fileName: string;
  hasHeader: boolean;
  delimiter: string;
  dedupeMode: DedupeMode;
  destination?: Record<string, unknown>;
  columnPlan?: unknown;
}): Promise<ImportJob | null> {
  if (!isAdminConfigured()) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("import_jobs")
      .insert({
        org_id: opts.orgId,
        created_by: opts.createdBy,
        file_name: opts.fileName.slice(0, 200),
        status: "running",
        has_header: opts.hasHeader,
        delimiter: opts.delimiter,
        dedupe_mode: opts.dedupeMode,
        destination: opts.destination ?? {},
        column_plan: opts.columnPlan ?? null,
      })
      .select(JOB_COLUMNS)
      .single();
    if (error || !data) return null;
    return rowToJob(data as unknown as Row);
  } catch {
    return null;
  }
}

export async function getImportJob(id: string): Promise<ImportJob | null> {
  if (!isAdminConfigured()) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("import_jobs")
      .select(JOB_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    return data ? rowToJob(data as unknown as Row) : null;
  } catch {
    return null;
  }
}

export async function listImportJobs(orgId: string, limit = 20): Promise<ImportJob[]> {
  if (!isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("import_jobs")
      .select(JOB_COLUMNS)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as unknown as Row[]).map(rowToJob);
  } catch {
    return [];
  }
}

/** Move a job to a terminal (or rolled-back) state, stamping the timestamps. */
export async function setImportJobStatus(
  id: string,
  status: ImportJobStatus,
): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  try {
    const admin = createAdminClient();
    const patch: Row = { status };
    if (status === "completed" || status === "canceled" || status === "failed") {
      patch.finished_at = new Date().toISOString();
    }
    if (status === "rolled_back") patch.rolled_back_at = new Date().toISOString();
    const { error } = await admin.from("import_jobs").update(patch).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/** Per-chunk accounting, applied atomically (chunks are separate requests). */
export async function bumpImportJob(
  jobId: string,
  counts: {
    rows?: number;
    created?: number;
    updated?: number;
    duplicates?: number;
    dnc?: number;
    invalid?: number;
    skipped?: number;
    failed?: number;
    errors?: { row: number; message: string }[];
  },
): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const admin = createAdminClient();
    await admin.rpc("app_import_job_bump", {
      p_job: jobId,
      p_rows: counts.rows ?? 0,
      p_created: counts.created ?? 0,
      p_updated: counts.updated ?? 0,
      p_dup: counts.duplicates ?? 0,
      p_dnc: counts.dnc ?? 0,
      p_invalid: counts.invalid ?? 0,
      p_skipped: counts.skipped ?? 0,
      p_failed: counts.failed ?? 0,
      p_errors: counts.errors ?? [],
    });
  } catch {
    // Accounting must never fail the import itself — the rows are what matter.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The chunk write
// ─────────────────────────────────────────────────────────────────────────────

/** One parsed row headed for the leads table, plus the import-only signals. */
export interface ImportChunkRow extends LeadInput {
  /** File's own DNC column flagged this row ⇒ stored with status 'dnc' and the
   *  number suppressed. */
  dnc?: boolean;
  dialingPreference?: DialingPreference | null;
}

export interface ImportChunkResult {
  created: number;
  updated: number;
  duplicates: number;
  invalidPhone: number;
  /** Rows the file's own DNC column flagged (imported suppressed, or their
   *  number suppressed onto an existing lead). */
  dncFlagged: number;
  failed: number;
  errors: { row: number; message: string }[];
  error?: string;
  /** True when there was nothing worth writing — an outcome, not a failure. */
  noop?: boolean;
}

/** Core columns `update` mode may fill — ONLY when the existing value is empty.
 *  status / owner / assignment are deliberately absent: enrichment never moves
 *  a lead through the pipeline or between reps. */
const PATCHABLE: { db: string; pick: (r: ImportChunkRow) => unknown }[] = [
  { db: "first_name", pick: (r) => r.firstName },
  { db: "last_name", pick: (r) => r.lastName },
  { db: "email", pick: (r) => r.email },
  { db: "address", pick: (r) => r.address },
  { db: "city", pick: (r) => r.city },
  { db: "state", pick: (r) => r.state },
  { db: "zip", pick: (r) => r.zip },
  { db: "utility_provider", pick: (r) => r.utilityProvider },
  { db: "solar_provider", pick: (r) => r.solarProvider },
  { db: "utility_bill", pick: (r) => r.utilityBill },
  { db: "solar_payment", pick: (r) => r.solarPayment },
  { db: "notes", pick: (r) => r.notes },
];

const isEmpty = (v: unknown) =>
  v == null || (typeof v === "string" && !v.trim()) || v === 0;

/**
 * Write one chunk of an import job.
 *
 * Replaces insertLeads' per-chunk full phone scan with ONE app_phone_matches
 * probe (chunk digits in, matching lead ids out), then applies the job's dedupe
 * mode row by row via decideImportAction. Inserts are stamped with provenance
 * (import_job_id / source_file / original_row) so the job is rollbackable, and
 * created_at keeps file order exactly the way insertLeads did.
 *
 * DNC-flagged rows (the file's own opt-out column) are imported with status
 * 'dnc' AND their numbers are pushed to dnc_numbers — stored and reportable,
 * never dialable. The caller has already scrubbed rows whose numbers were on
 * the org's suppression list BEFORE this ran (those are dncSkipped, not rows).
 */
export async function writeImportChunk(
  rows: ImportChunkRow[],
  opts: {
    orgId: string;
    /** Owner stamped on inserted rows (the importer). */
    ownerId: string;
    jobId?: string | null;
    sourceFile?: string | null;
    dedupeMode?: DedupeMode;
    /** This chunk's first data-row index within the whole file — drives both
     *  original_row and the created_at origin (file order across chunks). */
    rowOffset?: number;
  },
): Promise<ImportChunkResult> {
  const result: ImportChunkResult = {
    created: 0,
    updated: 0,
    duplicates: 0,
    invalidPhone: 0,
    dncFlagged: 0,
    failed: 0,
    errors: [],
  };
  if (!isAdminConfigured()) {
    return { ...result, error: "Connect Supabase to save leads." };
  }
  const mode = opts.dedupeMode ?? "skip";
  const rowOffset = Math.max(0, Math.floor(opts.rowOffset ?? 0));

  // Normalize phones the same way insertLeads always has: keep the original
  // when it can't be normalized (data isn't lost), count it invalid.
  const candidates = rows
    .map((r, i) => ({ row: r, fileIndex: rowOffset + i }))
    .filter(({ row: r }) => (r.phone && r.phone.trim()) || r.firstName)
    .map((c) => {
      const rawPhone = (c.row.phone ?? "").trim();
      const normalized = normalizePhone(rawPhone);
      if (rawPhone && !normalized) result.invalidPhone++;
      const phone = normalized || rawPhone;
      return { ...c, phone, digits: last10(phone) };
    });

  if (!candidates.length) return { ...result, noop: true };

  const admin = createAdminClient();

  // ONE probe for the whole chunk: which of these numbers already exist here?
  const uniqueDigits = [
    ...new Set(candidates.map((c) => c.digits).filter((d) => d.length === 10)),
  ];
  const existing = new Map<string, string>();
  if (uniqueDigits.length && mode !== "create_new") {
    const { data, error } = await admin.rpc("app_phone_matches", {
      p_org: opts.orgId,
      p_digits: uniqueDigits,
    });
    if (error) {
      count("import.probe_failed", 1, { orgId: opts.orgId });
      return { ...result, error: `Duplicate check failed: ${error.message}` };
    }
    for (const m of (data ?? []) as { digits: string; lead_id: string }[]) {
      if (!existing.has(String(m.digits))) existing.set(String(m.digits), String(m.lead_id));
    }
  }

  const seenInBatch = new Set<string>();
  const updatingIds = new Set<string>();
  const toCreate: typeof candidates = [];
  const toUpdate: { leadId: string; row: ImportChunkRow; fileIndex: number }[] = [];
  for (const c of candidates) {
    const action = decideImportAction({
      digits: c.digits,
      existingLeadId: existing.get(c.digits) ?? null,
      seenInBatch: seenInBatch.has(c.digits),
      mode,
    });
    if (c.digits.length === 10) seenInBatch.add(c.digits);
    if (action === "create") toCreate.push(c);
    else if (action === "update") {
      // An in-batch repeat of an existing number is a duplicate, not a second
      // update — the first occurrence already carried the enrichment.
      const leadId = existing.get(c.digits)!;
      if (updatingIds.has(leadId)) {
        result.duplicates++;
      } else {
        updatingIds.add(leadId);
        toUpdate.push({ leadId, row: c.row, fileIndex: c.fileIndex });
      }
    } else result.duplicates++;
  }

  // ── Updates: fill ONLY empty core fields; merge custom_fields atomically ───
  if (toUpdate.length) {
    const byId = new Map(toUpdate.map((u) => [u.leadId, u]));
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const { data, error } = await admin
        .from("leads")
        .select(
          "id, first_name, last_name, email, address, city, state, zip, " +
            "utility_provider, solar_provider, utility_bill, solar_payment, notes",
        )
        .in("id", slice);
      if (error) {
        result.failed += slice.length;
        result.errors.push({ row: -1, message: `Update read failed: ${error.message}` });
        continue;
      }
      for (const dbRow of (data ?? []) as unknown as Row[]) {
        const u = byId.get(String(dbRow.id));
        if (!u) continue;
        const patch: Row = {};
        for (const f of PATCHABLE) {
          const incoming = f.pick(u.row);
          if (incoming == null || incoming === "" || !isEmpty(dbRow[f.db])) continue;
          patch[f.db] = incoming;
        }
        try {
          if (Object.keys(patch).length) {
            const { error: upErr } = await admin
              .from("leads")
              .update(patch)
              .eq("id", u.leadId)
              .eq("org_id", opts.orgId);
            if (upErr) throw new Error(upErr.message);
          }
          if (u.row.customFields && Object.keys(u.row.customFields).length) {
            await admin.rpc("app_patch_lead_custom_fields", {
              p_lead: u.leadId,
              p_set: u.row.customFields,
              p_delete: [],
            });
          }
          result.updated++;
        } catch (e) {
          result.failed++;
          result.errors.push({
            row: u.fileIndex,
            message: e instanceof Error ? e.message : "Update failed.",
          });
        }
      }
    }
  }

  // ── Creates: stamped with provenance, created_at in file order ─────────────
  if (toCreate.length) {
    const base = Date.now() + rowOffset; // same origin trick as insertLeads
    const payload = toCreate.map((c, i) => {
      const r = c.row;
      if (r.dnc) result.dncFlagged++;
      return {
        owner_id: opts.ownerId,
        org_id: opts.orgId,
        first_name: r.firstName ?? "",
        last_name: r.lastName ?? "",
        phone: c.phone,
        email: r.email || null,
        address: r.address ?? "",
        city: r.city ?? "",
        state: r.state ?? "",
        zip: r.zip ?? "",
        utility_provider: r.utilityProvider ?? "",
        solar_provider: r.solarProvider ?? "",
        // A DNC-flagged row is stored suppressed — visible and reportable, but
        // structurally undialable from the moment it lands.
        status: r.dnc ? "dnc" : (r.status ?? "new"),
        utility_bill: r.utilityBill ?? null,
        solar_payment: r.solarPayment ?? null,
        campaign_id: r.campaignId ?? null,
        lead_group: r.leadGroup ?? null,
        lead_pack_id: r.leadPackId ?? null,
        county:
          r.county !== undefined ? r.county : (countyForZip(r.zip)?.county ?? null),
        notes: r.notes || null,
        custom_fields: r.customFields ?? {},
        dialing_preference: r.dialingPreference ?? "either",
        import_job_id: opts.jobId ?? null,
        source_file: opts.sourceFile ?? null,
        original_row: c.fileIndex,
        created_at: new Date(base + i).toISOString(),
      };
    });
    const BATCH = 500;
    for (let i = 0; i < payload.length; i += BATCH) {
      const slice = payload.slice(i, i + BATCH);
      const { error, count: inserted } = await admin
        .from("leads")
        .insert(slice, { count: "exact" });
      if (error) {
        // A failed slice is REPORTED, not silently swallowed — its rows land in
        // the job's error CSV with their original file positions.
        result.failed += slice.length;
        result.errors.push({
          row: toCreate[i]?.fileIndex ?? -1,
          message: error.message,
        });
        continue;
      }
      result.created += inserted ?? slice.length;
    }
  }

  // ── Suppress every number the file itself flagged Do-Not-Call ──────────────
  const flaggedPhones = candidates
    .filter((c) => c.row.dnc && c.digits.length === 10)
    .map((c) => c.phone);
  if (flaggedPhones.length) {
    await addManyToDnc({
      orgId: opts.orgId,
      phones: flaggedPhones,
      source: "import",
      createdBy: opts.ownerId,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rollback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete ONLY the provably-untouched rows an import job created. A lead that
 * has been dialed, contacted, moved off 'new', or that any call / appointment /
 * callback references is work — rollback keeps it and reports it kept.
 */
export async function rollbackImportJob(
  jobId: string,
  orgId: string,
): Promise<{ removed: number; keptWorked: number; error?: string }> {
  if (!isAdminConfigured()) {
    return { removed: 0, keptWorked: 0, error: "Connect Supabase first." };
  }
  try {
    const admin = createAdminClient();

    // Page through the job's rows explicitly (PostgREST caps at 1,000).
    type Candidate = {
      id: string;
      status: string;
      lastContactedAt: string | null;
      attemptCount: number | null;
    };
    const all: Candidate[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("leads")
        .select("id, status, last_contacted_at, attempt_count")
        .eq("import_job_id", jobId)
        .eq("org_id", orgId)
        .range(from, from + 999);
      if (error) return { removed: 0, keptWorked: 0, error: error.message };
      const page = (data ?? []) as unknown as Row[];
      for (const r of page) {
        all.push({
          id: String(r.id),
          status: String(r.status ?? ""),
          lastContactedAt: r.last_contacted_at ? String(r.last_contacted_at) : null,
          attemptCount: r.attempt_count == null ? 0 : Number(r.attempt_count),
        });
      }
      if (page.length < 1000) break;
      if (all.length >= 100_000) break; // hard stop — never OOM on a runaway job
    }

    // Field-level screen first, then the reference screen for the survivors.
    const fieldClean = all.filter((c) =>
      isUntouchedLead({ ...c, hasActivity: false }),
    );
    let keptWorked = all.length - fieldClean.length;

    const referenced = new Set<string>();
    const cleanIds = fieldClean.map((c) => c.id);
    for (let i = 0; i < cleanIds.length; i += 100) {
      const slice = cleanIds.slice(i, i + 100);
      for (const table of ["call_records", "appointments", "callbacks"]) {
        const { data } = await admin.from(table).select("lead_id").in("lead_id", slice);
        for (const r of (data ?? []) as Row[]) {
          if (r.lead_id) referenced.add(String(r.lead_id));
        }
      }
    }

    const deletable = cleanIds.filter((id) => !referenced.has(id));
    keptWorked += cleanIds.length - deletable.length;

    let removed = 0;
    for (let i = 0; i < deletable.length; i += 100) {
      const slice = deletable.slice(i, i + 100);
      const { error, count: n } = await admin
        .from("leads")
        .delete({ count: "exact" })
        .in("id", slice)
        .eq("org_id", orgId)
        .eq("import_job_id", jobId);
      if (error) {
        return { removed, keptWorked, error: error.message };
      }
      removed += n ?? slice.length;
    }

    await setImportJobStatus(jobId, "rolled_back");
    count("import.rolled_back", 1, { orgId, removed, keptWorked });
    return { removed, keptWorked };
  } catch (e) {
    return {
      removed: 0,
      keptWorked: 0,
      error: e instanceof Error ? e.message : "Rollback failed.",
    };
  }
}
