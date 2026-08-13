import type { Lead } from "../types";
import { formatCurrency, formatPhone } from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// Lead field schema — the foundation of the generic (non-solar) dialer.
//
// The eight solar-era lead columns become typed CORE SLOTS that vertical
// templates relabel or hide: an insurance org's "Current premium ($/mo)" is the
// same typed column solar calls "Utility bill", so every existing mechanism
// (SQL filters, smart lists, reports) keeps working. Everything else a CSV
// carries lands in leads.custom_fields (jsonb), keyed by a normalized
// snake_case version of its header, typed at import time.
//
// PURE + isomorphic (no DB, no server-only) — imported by the CSV parser, the
// table renderer, the qualify panel, and the AI layer alike.
// ─────────────────────────────────────────────────────────────────────────────

export type LeadFieldType =
  | "text"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "phone"
  | "email"
  | "url";

export interface LeadFieldDef {
  /** Core: the Lead camelCase property. Custom: normalized snake_case header. */
  key: string;
  label: string;
  type: LeadFieldType;
  source: "core" | "custom";
  showInTable: boolean;
  showInQualify: boolean;
}

/** The relabelable core slots, with their solar-era default presentation. */
export const CORE_LEAD_FIELDS: LeadFieldDef[] = [
  { key: "utilityBill", label: "Utility bill ($/mo)", type: "currency", source: "core", showInTable: true, showInQualify: true },
  { key: "solarPayment", label: "Solar payment ($/mo)", type: "currency", source: "core", showInTable: false, showInQualify: true },
  { key: "utilityProvider", label: "Utility provider", type: "text", source: "core", showInTable: false, showInQualify: false },
  { key: "solarProvider", label: "Solar provider", type: "text", source: "core", showInTable: false, showInQualify: false },
  { key: "hasEV", label: "EV", type: "boolean", source: "core", showInTable: true, showInQualify: true },
  { key: "hasPool", label: "Pool", type: "boolean", source: "core", showInTable: true, showInQualify: true },
  { key: "hasBattery", label: "Battery", type: "boolean", source: "core", showInTable: true, showInQualify: true },
  { key: "multipleSystems", label: "Multiple systems", type: "boolean", source: "core", showInTable: false, showInQualify: false },
];

const CORE_KEYS = new Set(CORE_LEAD_FIELDS.map((f) => f.key));

/**
 * "Policy Expiry (date) " → "policy_expiry_date". Empty when nothing survives.
 * MUST be idempotent — /api/leads/update rejects any key where
 * key !== normalizeFieldKey(key), so the trailing-underscore strip has to run
 * AFTER the length cap (slicing at 48 can land on an underscore).
 */
export function normalizeFieldKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");
}

/**
 * Normalized keys that must NEVER become custom fields: the CSV export's
 * metadata tail columns (documented as "ignored on re-import" — capturing them
 * would register 11 junk fields and store stale per-lead shadows of live
 * columns like status/ai_score), plus core column names that could shadow
 * real lead properties.
 */
export const RESERVED_FIELD_KEYS = new Set([
  "status",
  "lead_group",
  "group",
  "campaign",
  "campaign_id",
  "has_ev",
  "has_pool",
  "has_battery",
  "multiple_systems",
  "ai_score",
  "score",
  "timezone",
  "last_contacted",
  "last_contacted_at",
  "created_at",
  "uploaded_by",
  "owner",
  "owner_id",
  "notes",
  "phone",
  "email",
  "first_name",
  "last_name",
  "name",
  "full_name",
  "address",
  "city",
  "state",
  "zip",
  "utility_provider",
  "solar_provider",
  "utility_bill",
  "solar_payment",
]);

const MONEY_RE = /^\s*-?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*$/;
const NUMBER_RE = /^\s*-?\d+(?:\.\d+)?\s*$/;
const BOOL_TRUE = new Set(["true", "yes", "y", "1", "x"]);
const BOOL_FALSE = new Set(["false", "no", "n", "0", ""]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/\S+$/i;
const PHONE_RE = /^[\s()+.-]*(?:\d[\s()+.-]*){10,15}$/;
const DATE_RE = /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}(?:[T ].*)?$/;

/**
 * Detect a column's type from its non-empty sample values. A type wins only
 * when ≥60% of samples agree — mixed columns stay text rather than mangling
 * values at import time.
 */
export function detectFieldType(samples: string[]): LeadFieldType {
  const vals = samples.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 200);
  if (vals.length === 0) return "text";
  const share = (pred: (v: string) => boolean) =>
    vals.filter(pred).length / vals.length;

  // Order matters: money is also number-ish; dates are also number-ish.
  if (share((v) => MONEY_RE.test(v) && v.includes("$")) >= 0.6) return "currency";
  if (share((v) => BOOL_TRUE.has(v.toLowerCase()) || BOOL_FALSE.has(v.toLowerCase())) >= 0.9)
    return "boolean";
  if (share((v) => EMAIL_RE.test(v)) >= 0.6) return "email";
  if (share((v) => URL_RE.test(v)) >= 0.6) return "url";
  if (share((v) => DATE_RE.test(v) && !Number.isNaN(Date.parse(v))) >= 0.6) return "date";
  if (share((v) => PHONE_RE.test(v) && v.replace(/\D/g, "").length >= 10) >= 0.6)
    return "phone";
  if (share((v) => NUMBER_RE.test(v) || MONEY_RE.test(v)) >= 0.6) {
    // Identifier-shaped numerics must stay TEXT: zero-padded codes ("00123")
    // lose their leading zeros through Number(), and 16+ digit ids lose
    // precision past 2^53. Both corruptions are permanent.
    if (share((v) => /^0\d+$/.test(v)) >= 0.2) return "text";
    if (share((v) => /^\d{16,}$/.test(v.replace(/\D/g, ""))) >= 0.2) return "text";
    // All-numeric but $-less: money only when values look like dollar amounts
    // with cents; otherwise a plain number (zip-like columns map elsewhere).
    return share((v) => /\.\d{2}\s*$/.test(v)) >= 0.6 ? "currency" : "number";
  }
  return "text";
}

/** Import-time coercion of one cell to its column's detected type. */
export function parseFieldValue(
  raw: string,
  type: LeadFieldType,
): string | number | boolean {
  const v = String(raw ?? "").trim();
  switch (type) {
    case "currency":
    case "number": {
      // A digit-less value ("N/A", "TBD", a lone "$") must survive as text —
      // stripping to "" makes Number("") === 0, a finite number, so the
      // isFinite fallback alone silently turned every placeholder into $0.
      const cleaned = v.replace(/[^0-9.-]/g, "");
      if (!/\d/.test(cleaned)) return v;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : v;
    }
    case "boolean":
      return BOOL_TRUE.has(v.toLowerCase());
    default:
      return v;
  }
}

/** Display formatting by type — reuses the app's shared formatters. */
export function formatFieldValue(
  value: string | number | boolean | null | undefined,
  type: LeadFieldType,
): string {
  if (value == null || value === "") return "—";
  switch (type) {
    case "currency":
      return typeof value === "number" ? formatCurrency(value) : String(value);
    case "number":
      return String(value);
    case "boolean":
      return value === true ? "Yes" : "—";
    case "phone":
      return formatPhone(String(value));
    case "date": {
      const t = Date.parse(String(value));
      return Number.isNaN(t) ? String(value) : new Date(t).toLocaleDateString();
    }
    default:
      return String(value);
  }
}

/** Template-level presentation overrides for the core slots. */
export interface CoreFieldOverrides {
  labels?: Partial<Record<string, string>>;
  hidden?: string[];
}

/**
 * The org's effective field schema: explicit settings.leadFields when present
 * (custom defs + core overrides saved by imports/Admin), otherwise the core
 * slots with the template's relabels/hides applied.
 */
export function resolveLeadFields(
  settingsFields: LeadFieldDef[] | undefined,
  templateOverrides?: CoreFieldOverrides,
): LeadFieldDef[] {
  const saved = Array.isArray(settingsFields) ? settingsFields : [];
  const savedCore = new Map(saved.filter((f) => f.source === "core").map((f) => [f.key, f]));
  const hidden = new Set(templateOverrides?.hidden ?? []);
  const core = CORE_LEAD_FIELDS.map((def) => {
    const override = savedCore.get(def.key);
    if (override) return override; // explicit org config wins outright
    const label = templateOverrides?.labels?.[def.key] ?? def.label;
    const hide = hidden.has(def.key);
    return {
      ...def,
      label,
      showInTable: hide ? false : def.showInTable,
      showInQualify: hide ? false : def.showInQualify,
    };
  });
  const custom = saved.filter((f) => f.source === "custom" && !CORE_KEYS.has(f.key));
  return [...core, ...custom];
}

/** Read a field's value off a lead, wherever it lives. */
export function leadFieldValue(
  lead: Lead,
  def: LeadFieldDef,
): string | number | boolean | null | undefined {
  if (def.source === "core") {
    return (lead as unknown as Record<string, string | number | boolean | undefined>)[
      def.key
    ];
  }
  return lead.customFields?.[def.key];
}
