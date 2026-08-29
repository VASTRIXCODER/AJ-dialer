import { csvCell, csvLine } from "../csv-safety";
import type { LeadFieldType } from "./field-schema";
import { normalizeFieldKey } from "./field-schema";
import { sanitizeFilterSpec, type FilterSpec } from "./filter-spec";

// ─────────────────────────────────────────────────────────────────────────────
// Flexible export — the one grammar for "which columns, in what shape, of which
// rows" (Export v2). An ExportSpec travels as untrusted JSON (the dialog's POST
// body, saved templates in org settings), so everything that enters the system
// goes through sanitizeExportSpec: column keys are whitelisted (custom keys
// against the org's OWN schema), sizes are capped, and anything that doesn't
// fit is DROPPED rather than erroring — mirroring sanitizeFilterSpec's posture.
//
// Column VALUES are stored keys where the store has keys (status, outcomes,
// dispositions — contracts, not prose); column HEADERS are the org's words:
// they default from the resolved field schema in the dialog and survive rename
// here. Nothing in this module hardcodes an industry noun beyond the solar-era
// core-slot DEFAULT labels, which are the same stored defaults
// CORE_LEAD_FIELDS carries — the dialog overlays the org's resolved labels.
//
// PURE + isomorphic (no DB, no server-only) — imported by the export dialog,
// the /api/leads/export/v2 route, and org settings alike.
// ─────────────────────────────────────────────────────────────────────────────

/** Core lead columns (the `leads` table through the app's Lead shape; id excluded). */
export const CORE_EXPORT_KEYS = [
  "first_name",
  "last_name",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "county",
  "zip",
  "timezone",
  "status",
  "lead_group",
  "utility_provider",
  "solar_provider",
  "utility_bill",
  "solar_payment",
  "has_ev",
  "has_pool",
  "has_battery",
  "multiple_systems",
  "notes",
  "ai_score",
  "dialing_preference",
  "created_at",
  "last_contacted_at",
] as const;
export type CoreExportKey = (typeof CORE_EXPORT_KEYS)[number];

/** Derived / joined columns the route enriches per page (calls, people, packs…). */
export const ACTIVITY_EXPORT_KEYS = [
  "latest_outcome",
  "latest_disposition",
  "assigned_rep_name",
  "owner_name",
  "pack_label",
  "campaign_name",
  "attempt_count",
  "last_attempt_at",
  "next_appointment_at",
  "next_callback_at",
  "dnc_state",
  "import_file",
] as const;
export type ActivityExportKey = (typeof ACTIVITY_EXPORT_KEYS)[number];

export type StandardExportKey = CoreExportKey | ActivityExportKey;
export type ExportColumnKey = StandardExportKey | `custom:${string}`;

export interface ExportColumn {
  key: ExportColumnKey;
  /** What the CSV's header row says — renameable, capped, never a stored key. */
  header: string;
}

export interface ExportFormat {
  delimiter: "," | ";" | "\t";
  dateFormat: "iso" | "us";
  /** IANA zone timestamps render in. Absent = UTC/as-stored. */
  timezone?: string;
  /** What an empty cell prints as. */
  nullAs: "" | "—";
  /** Prepend the UTF-8 BOM so Excel reads accents correctly. */
  bom: boolean;
}

export interface ExportSpec {
  /** null = everything in the caller's scope (the route still scopes rows). */
  filter: FilterSpec | null;
  columns: ExportColumn[];
  format: ExportFormat;
}

/** A saved export setup (org settings key `exportTemplates`). */
export interface ExportTemplate {
  id: string;
  name: string;
  columns: ExportColumn[];
  format: ExportFormat;
}

export const EXPORT_MAX_COLUMNS = 60;
export const EXPORT_MAX_HEADER_CHARS = 80;
export const EXPORT_MAX_TEMPLATES = 20;
export const EXPORT_MAX_TEMPLATE_NAME = 60;
/** Hard row cap — beyond it the file ends with EXPORT_TRUNCATION_NOTE. */
export const EXPORT_ROW_CAP = 50_000;
/** Page size the route walks app_filter_leads with. */
export const EXPORT_PAGE_SIZE = 1_000;
/** The literal final line of a capped file — greppable, never a data row. */
export const EXPORT_TRUNCATION_NOTE = "# TRUNCATED — narrow the filter";

/** Did the matched set overflow the cap? (Pure — the route trusts this.) */
export function isExportTruncated(matchedTotal: number): boolean {
  return matchedTotal > EXPORT_ROW_CAP;
}

/**
 * Fallback header text per standard key. The 8 relabelable core slots carry the
 * SAME solar-era defaults CORE_LEAD_FIELDS stores — the dialog overlays the
 * org's resolved schema labels, so a non-solar tenant never sees these.
 */
export const EXPORT_COLUMN_LABELS: Record<StandardExportKey, string> = {
  first_name: "First name",
  last_name: "Last name",
  phone: "Phone",
  email: "Email",
  address: "Address",
  city: "City",
  state: "State",
  county: "County",
  zip: "ZIP",
  timezone: "Timezone",
  status: "Status",
  lead_group: "Group",
  utility_provider: "Utility provider",
  solar_provider: "Solar provider",
  utility_bill: "Utility bill ($/mo)",
  solar_payment: "Solar payment ($/mo)",
  has_ev: "EV",
  has_pool: "Pool",
  has_battery: "Battery",
  multiple_systems: "Multiple systems",
  notes: "Notes",
  ai_score: "AI score",
  dialing_preference: "Dialing preference",
  created_at: "Created",
  last_contacted_at: "Last contacted",
  latest_outcome: "Latest outcome",
  latest_disposition: "Latest disposition",
  assigned_rep_name: "Assigned rep",
  owner_name: "Uploaded by",
  pack_label: "Assignment pack",
  campaign_name: "Campaign",
  attempt_count: "Attempts",
  last_attempt_at: "Last attempt",
  next_appointment_at: "Next appointment",
  next_callback_at: "Next callback",
  dnc_state: "DNC",
  import_file: "Import file",
};

const STANDARD_KEYS: ReadonlySet<string> = new Set<string>([
  ...CORE_EXPORT_KEYS,
  ...ACTIVITY_EXPORT_KEYS,
]);

/** The dialog's starting selection — contactable identity + working state. */
export const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = (
  [
    "first_name",
    "last_name",
    "phone",
    "email",
    "address",
    "city",
    "state",
    "zip",
    "status",
    "latest_outcome",
    "assigned_rep_name",
    "attempt_count",
    "last_attempt_at",
    "notes",
    "created_at",
  ] as StandardExportKey[]
).map((key) => ({ key, header: EXPORT_COLUMN_LABELS[key] }));

export const DEFAULT_EXPORT_FORMAT: ExportFormat = {
  delimiter: ",",
  dateFormat: "iso",
  nullAs: "",
  bom: true,
};

// Loose IANA-zone shape ("America/Chicago", "UTC", "Etc/GMT+2"). Wrong-but-
// well-formed zones are caught again at format time (Intl throws → UTC).
const TIMEZONE_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;

function sanitizeFormat(raw: unknown): ExportFormat {
  const f = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const delimiter =
    f.delimiter === ";" || f.delimiter === "\t" ? f.delimiter : ",";
  const dateFormat = f.dateFormat === "us" ? "us" : "iso";
  const nullAs = f.nullAs === "—" ? "—" : "";
  const bom = typeof f.bom === "boolean" ? f.bom : true;
  const tz =
    typeof f.timezone === "string" && TIMEZONE_RE.test(f.timezone.trim())
      ? f.timezone.trim()
      : undefined;
  return tz
    ? { delimiter, dateFormat, timezone: tz, nullAs, bom }
    : { delimiter, dateFormat, nullAs, bom };
}

/**
 * Whitelist + shape one raw column list. `allowedCustomKeys` is the org's OWN
 * custom schema keys; null skips that check (template storage — the live
 * allowlist re-validates at export time). Returns null when `raw` isn't an
 * array at all, so callers can distinguish "absent" from "all invalid" ([]).
 */
function sanitizeColumns(
  raw: unknown,
  allowedCustomKeys: ReadonlySet<string> | null,
): ExportColumn[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ExportColumn[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= EXPORT_MAX_COLUMNS) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.key !== "string" || c.key.length === 0 || c.key.length > 140) continue;
    const key = c.key;
    let fallback: string;
    if (key.startsWith("custom:")) {
      const customKey = key.slice("custom:".length);
      // A key that isn't its own normalization can't exist in custom_fields.
      if (!customKey || customKey !== normalizeFieldKey(customKey)) continue;
      if (allowedCustomKeys && !allowedCustomKeys.has(customKey)) continue;
      fallback = customKey;
    } else if (STANDARD_KEYS.has(key)) {
      fallback = EXPORT_COLUMN_LABELS[key as StandardExportKey];
    } else {
      continue; // unknown key — dropped, never erred
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const rawHeader = typeof c.header === "string" ? c.header.trim() : "";
    const header = (rawHeader || fallback).slice(0, EXPORT_MAX_HEADER_CHARS);
    out.push({ key: key as ExportColumnKey, header });
  }
  return out;
}

/**
 * Validate an untrusted ExportSpec. Unknown/duplicate/foreign-custom columns
 * are DROPPED; a missing column list falls back to DEFAULT_EXPORT_COLUMNS; a
 * PRESENT list with nothing valid left is null (the caller 400s — silently
 * exporting the default set when the user picked columns would be a lie).
 */
export function sanitizeExportSpec(
  raw: unknown,
  allowedCustomKeys: string[],
): ExportSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const allow = new Set(allowedCustomKeys);
  const provided = sanitizeColumns(r.columns, allow);
  if (provided !== null && provided.length === 0) return null;
  return {
    filter: sanitizeFilterSpec(r.filter),
    columns: provided ?? DEFAULT_EXPORT_COLUMNS.map((c) => ({ ...c })),
    format: sanitizeFormat(r.format),
  };
}

/**
 * Validate the org-settings `exportTemplates` array (untrusted JSONB). Custom
 * column keys are shape-checked only — the export route re-validates against
 * the live schema, so a template referencing a since-deleted field degrades to
 * its surviving columns instead of vanishing.
 */
export function sanitizeExportTemplates(raw: unknown): ExportTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: ExportTemplate[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= EXPORT_MAX_TEMPLATES) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || !t.id || t.id.length > 64 || seen.has(t.id)) continue;
    const name = typeof t.name === "string" ? t.name.trim().slice(0, EXPORT_MAX_TEMPLATE_NAME) : "";
    if (!name) continue;
    const columns = sanitizeColumns(t.columns, null);
    if (!columns || columns.length === 0) continue;
    seen.add(t.id);
    out.push({ id: t.id, name, columns, format: sanitizeFormat(t.format) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cell formatting — value → the string a cell prints as (before csvCell's
// injection/quoting pass). Pure so tests can pin delimiter/date/null behavior.
// ─────────────────────────────────────────────────────────────────────────────

export type ExportCellKind = "text" | "number" | "boolean" | "date";

const KEY_KIND: Record<StandardExportKey, ExportCellKind> = {
  first_name: "text",
  last_name: "text",
  phone: "text",
  email: "text",
  address: "text",
  city: "text",
  state: "text",
  county: "text",
  zip: "text",
  timezone: "text",
  status: "text",
  lead_group: "text",
  utility_provider: "text",
  solar_provider: "text",
  utility_bill: "number",
  solar_payment: "number",
  has_ev: "boolean",
  has_pool: "boolean",
  has_battery: "boolean",
  multiple_systems: "boolean",
  notes: "text",
  ai_score: "number",
  dialing_preference: "text",
  created_at: "date",
  last_contacted_at: "date",
  latest_outcome: "text",
  latest_disposition: "text",
  assigned_rep_name: "text",
  owner_name: "text",
  pack_label: "text",
  campaign_name: "text",
  attempt_count: "number",
  last_attempt_at: "date",
  next_appointment_at: "date",
  next_callback_at: "date",
  dnc_state: "text",
  import_file: "text",
};

/** Collapse a custom field's LeadFieldType into a formatting kind. */
const CUSTOM_KIND: Record<LeadFieldType, ExportCellKind> = {
  text: "text",
  phone: "text",
  email: "text",
  url: "text",
  number: "number",
  currency: "number",
  boolean: "boolean",
  date: "date",
};

/** Which formatter a column runs through. Custom types come from the org schema. */
export function exportCellKind(
  key: ExportColumnKey,
  customTypes?: Record<string, LeadFieldType>,
): ExportCellKind {
  if (key.startsWith("custom:")) {
    const t = customTypes?.[key.slice("custom:".length)];
    return t ? CUSTOM_KIND[t] : "text";
  }
  return KEY_KIND[key as StandardExportKey] ?? "text";
}

function formatDateValue(t: number, format: ExportFormat): string {
  if (format.dateFormat === "us") {
    // en-US "MM/DD/YYYY, HH:mm". hourCycle pinned — hour12:false historically
    // rendered midnight as "24:00" on some engines.
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: format.timezone || "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(t);
    } catch {
      // Bad zone name that slipped the shape check — fall through to UTC.
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(t);
    }
  }
  if (format.timezone) {
    // sv-SE renders "YYYY-MM-DD HH:mm:ss" — ISO-shaped local time in the zone.
    try {
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: format.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(t);
    } catch {
      /* bad zone — fall through to UTC ISO */
    }
  }
  return new Date(t).toISOString();
}

/**
 * One cell's printed text. Injection-neutralization and quoting are csvCell's
 * job (exportRowLine below) — this only decides WHAT the cell says: nullAs for
 * empties, Yes/No booleans, dates per dateFormat/timezone, raw text otherwise.
 */
export function formatExportCell(
  value: unknown,
  kind: ExportCellKind,
  format: ExportFormat,
): string {
  if (value == null || value === "") return format.nullAs;
  switch (kind) {
    case "boolean":
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return String(value);
    case "date": {
      const t = Date.parse(String(value));
      // Unparseable "dates" print as-is — a lossy blank would hide real data.
      return Number.isNaN(t) ? String(value) : formatDateValue(t, format);
    }
    default:
      return String(value);
  }
}

/**
 * One encoded CSV row in the spec's delimiter (cells already formatted).
 * csvCell's quoting triggers on commas only, so for ";"/tab exports a cell
 * CONTAINING the delimiter gets the RFC-4180 quote pass here — otherwise one
 * semicolon inside a note would shift every column after it.
 */
export function exportRowLine(cells: readonly unknown[], format: ExportFormat): string {
  const d = format.delimiter;
  if (d === ",") return csvLine(cells, d);
  return cells
    .map((v) => {
      const s = csvCell(v);
      return !s.startsWith('"') && s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(d);
}
