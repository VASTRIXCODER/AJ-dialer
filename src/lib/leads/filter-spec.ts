import type { LeadFieldType } from "./field-schema";
import { normalizeFieldKey } from "./field-schema";

// ─────────────────────────────────────────────────────────────────────────────
// Typed lead filters — the one grammar for every saved view, list URL, and
// (later) SQL WHERE clause.
//
// A FilterSpec is groups-of-conditions with AND/OR at both levels. It travels
// as untrusted JSON (URL params, saved views, API bodies), so everything that
// enters the system goes through sanitizeFilterSpec: keys are whitelisted, each
// comparator is whitelisted per field TYPE, sizes are capped, and anything that
// doesn't fit is DROPPED rather than erroring — a half-corrupt saved view
// degrades to the conditions that still make sense instead of a blank screen.
//
// evaluateFilter is the reference semantics. The SQL generator that follows
// must agree with it condition-for-condition — the parity fixture in
// tests/filter-evaluator.test.ts is that contract. Deliberate choices both
// sides must mirror:
//   • text/enum fields treat null as "" (SQL side: COALESCE(col, ''));
//   • a numeric comparator over a non-numeric custom value matches NOTHING,
//     even `neq` (SQL side: the jsonb typeof/safe-cast guard);
//   • `contains`/`starts_with` are case-insensitive (ILIKE); eq/in are exact;
//   • `within_days` is distance from now in EITHER direction (serves both
//     "contacted in the last 7 days" and "eligible within the next 7 days");
//   • dates compare as parsed timestamps of ISO strings.
//
// PURE + isomorphic (no DB, no server-only) — imported by the leads table, the
// filter builder UI, the API routes, and the SQL compiler alike.
// ─────────────────────────────────────────────────────────────────────────────

export type FilterCmp =
  | "eq"
  | "neq"
  | "in"
  | "nin"
  | "contains"
  | "starts_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "is_empty"
  | "not_empty"
  | "is_true"
  | "is_false"
  | "before"
  | "after"
  | "within_days"
  | "older_than_days";

export type FilterFieldKey =
  | "status"
  | "campaign_id"
  | "lead_group"
  | "lead_pack_id"
  | "assigned_rep_id"
  | "owner_id"
  | "city"
  | "state"
  | "county"
  | "zip"
  | "timezone"
  | "created_at"
  | "last_contacted_at"
  | "utility_bill"
  | "solar_payment"
  | "has_ev"
  | "has_pool"
  | "has_battery"
  | "multiple_systems"
  | "import_job_id"
  | "source_file"
  | "dialing_preference"
  | "attempt_count"
  | "last_attempt_at"
  | "next_eligible_at"
  | "phone_valid"
  | "dnc"
  | "never_dialed"
  | "dial_eligible"
  | "latest_outcome"
  | "has_open_callback"
  | "has_scheduled_appointment"
  | "unassigned"
  | "archived"
  | "search";

export type FilterValue = string | number | boolean | string[] | [number, number];

export type FilterCondition =
  | { kind: "core" | "derived"; key: FilterFieldKey; cmp: FilterCmp; value?: FilterValue }
  | { kind: "custom"; key: string; type: LeadFieldType; cmp: FilterCmp; value?: FilterValue };

export interface FilterGroup {
  op: "and" | "or";
  conditions: FilterCondition[];
}

export interface FilterSpec {
  op: "and" | "or";
  groups: FilterGroup[];
}

/** The comparator families. Every key resolves to exactly one of these. */
export type FilterValueType = "text" | "number" | "boolean" | "date" | "enum";

/**
 * What TYPE each whitelisted key is — this is what decides which comparators
 * sanitizeFilterSpec accepts for it. "enum" means "an opaque stored key"
 * (status, campaign id, outcome …): exact match / set membership only, never
 * substring — the stored keys (`bills_fine`, `do_not_call`, …) are contracts,
 * not prose.
 */
export const FILTER_FIELD_TYPES: Record<FilterFieldKey, FilterValueType> = {
  status: "enum",
  campaign_id: "enum",
  lead_group: "enum",
  lead_pack_id: "enum",
  assigned_rep_id: "enum",
  owner_id: "enum",
  city: "text",
  state: "text",
  county: "text",
  zip: "text",
  timezone: "text",
  created_at: "date",
  last_contacted_at: "date",
  utility_bill: "number",
  solar_payment: "number",
  has_ev: "boolean",
  has_pool: "boolean",
  has_battery: "boolean",
  multiple_systems: "boolean",
  import_job_id: "enum",
  source_file: "text",
  dialing_preference: "enum",
  attempt_count: "number",
  last_attempt_at: "date",
  next_eligible_at: "date",
  phone_valid: "boolean",
  dnc: "boolean",
  never_dialed: "boolean",
  dial_eligible: "boolean",
  latest_outcome: "enum",
  has_open_callback: "boolean",
  has_scheduled_appointment: "boolean",
  unassigned: "boolean",
  archived: "boolean",
  search: "text",
};

/**
 * Keys that aren't a plain column read — they're computed from other inputs
 * (digit sets, join flags, "assigned_rep_id IS NULL"). The sanitizer stamps
 * `kind` from this set, never from the payload, so the SQL compiler can trust
 * `kind: "derived"` to mean "needs its own expression, not a column ref."
 */
export const DERIVED_FILTER_KEYS: ReadonlySet<FilterFieldKey> = new Set([
  "phone_valid",
  "dnc",
  "never_dialed",
  "dial_eligible",
  "latest_outcome",
  "has_open_callback",
  "has_scheduled_appointment",
  "unassigned",
  "archived",
  "search",
]);

const TEXT_CMPS = new Set<FilterCmp>(["eq", "neq", "in", "nin", "contains", "starts_with", "is_empty", "not_empty"]);
const ENUM_CMPS = new Set<FilterCmp>(["eq", "neq", "in", "nin", "is_empty", "not_empty"]);
const NUMBER_CMPS = new Set<FilterCmp>(["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"]);
const BOOLEAN_CMPS = new Set<FilterCmp>(["is_true", "is_false"]);
const DATE_CMPS = new Set<FilterCmp>(["before", "after", "within_days", "older_than_days", "is_empty", "not_empty"]);

/** Which comparators each type family admits — the sanitizer's whitelist. */
export const FILTER_CMPS_BY_TYPE: Record<FilterValueType, ReadonlySet<FilterCmp>> = {
  text: TEXT_CMPS,
  enum: ENUM_CMPS,
  number: NUMBER_CMPS,
  boolean: BOOLEAN_CMPS,
  date: DATE_CMPS,
};

/** Collapse the import-time LeadFieldType into a comparator family. */
const CUSTOM_TYPE_FAMILY: Record<LeadFieldType, FilterValueType> = {
  text: "text",
  phone: "text",
  email: "text",
  url: "text",
  number: "number",
  currency: "number",
  boolean: "boolean",
  date: "date",
};

const ALL_CMPS = new Set<string>([
  ...TEXT_CMPS, ...ENUM_CMPS, ...NUMBER_CMPS, ...BOOLEAN_CMPS, ...DATE_CMPS,
]);

const MAX_GROUPS = 8;
const MAX_CONDITIONS = 8;
const MAX_STRING_VALUE = 200;
const MAX_ARRAY_VALUE = 50;

/** Sentinel for "the value doesn't fit this comparator — drop the condition." */
const INVALID = Symbol("invalid");

function sanitizeValue(
  family: FilterValueType,
  cmp: FilterCmp,
  v: unknown,
): FilterValue | undefined | typeof INVALID {
  switch (cmp) {
    // Valueless comparators: strip whatever came along — a stray value must not
    // survive into saved views or the SQL compiler.
    case "is_empty":
    case "not_empty":
    case "is_true":
    case "is_false":
      return undefined;
    case "in":
    case "nin": {
      if (!Array.isArray(v) || v.length === 0 || v.length > MAX_ARRAY_VALUE) return INVALID;
      const items: string[] = [];
      for (const x of v) {
        if (typeof x !== "string" || x.length > MAX_STRING_VALUE) return INVALID;
        items.push(x);
      }
      return items;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return typeof v === "number" && Number.isFinite(v) ? v : INVALID;
    case "within_days":
    case "older_than_days":
      return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : INVALID;
    case "between":
      return Array.isArray(v) &&
        v.length === 2 &&
        v.every((n) => typeof n === "number" && Number.isFinite(n))
        ? [v[0] as number, v[1] as number]
        : INVALID;
    case "contains":
    case "starts_with":
      return typeof v === "string" && v.length <= MAX_STRING_VALUE ? v : INVALID;
    case "before":
    case "after":
      // Must actually parse — an unparseable date would silently match nothing
      // forever, which is worse than dropping the condition now.
      return typeof v === "string" && v.length <= MAX_STRING_VALUE && !Number.isNaN(Date.parse(v))
        ? v
        : INVALID;
    case "eq":
    case "neq":
      if (family === "number") return typeof v === "number" && Number.isFinite(v) ? v : INVALID;
      return typeof v === "string" && v.length <= MAX_STRING_VALUE ? v : INVALID;
  }
}

function sanitizeCondition(raw: unknown): FilterCondition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const cmp = c.cmp;
  if (typeof cmp !== "string" || !ALL_CMPS.has(cmp)) return null;
  const key = c.key;
  if (typeof key !== "string" || key.length === 0) return null;

  // Own-property checks, never `in`: `"__proto__" in {}` is true through the
  // prototype chain, and this key arrives from untrusted JSON.
  const own = (obj: object, k: string) => Object.prototype.hasOwnProperty.call(obj, k);

  if (c.kind === "custom") {
    const type = c.type;
    if (typeof type !== "string" || !own(CUSTOM_TYPE_FAMILY, type)) return null;
    // A key that isn't its own normalization can't exist in custom_fields —
    // /api/leads/update enforces the same invariant on write.
    if (key !== normalizeFieldKey(key)) return null;
    const family = CUSTOM_TYPE_FAMILY[type as LeadFieldType];
    if (!FILTER_CMPS_BY_TYPE[family].has(cmp as FilterCmp)) return null;
    const value = sanitizeValue(family, cmp as FilterCmp, c.value);
    if (value === INVALID) return null;
    return value === undefined
      ? { kind: "custom", key, type: type as LeadFieldType, cmp: cmp as FilterCmp }
      : { kind: "custom", key, type: type as LeadFieldType, cmp: cmp as FilterCmp, value };
  }

  if (!own(FILTER_FIELD_TYPES, key)) return null;
  const fieldKey = key as FilterFieldKey;
  const family = FILTER_FIELD_TYPES[fieldKey];
  if (!FILTER_CMPS_BY_TYPE[family].has(cmp as FilterCmp)) return null;
  const value = sanitizeValue(family, cmp as FilterCmp, c.value);
  if (value === INVALID) return null;
  const kind = DERIVED_FILTER_KEYS.has(fieldKey) ? "derived" : "core";
  return value === undefined
    ? { kind, key: fieldKey, cmp: cmp as FilterCmp }
    : { kind, key: fieldKey, cmp: cmp as FilterCmp, value };
}

/**
 * Validate an untrusted spec into a safe one. Invalid conditions are DROPPED
 * (not fatal); groups beyond 8 and conditions beyond 8-per-group are dropped;
 * a group with nothing valid left disappears; null when no group survives —
 * the caller treats null as "no filter."
 */
export function sanitizeFilterSpec(raw: unknown): FilterSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { op?: unknown; groups?: unknown };
  if (!Array.isArray(r.groups)) return null;
  const groups: FilterGroup[] = [];
  for (const g of r.groups.slice(0, MAX_GROUPS)) {
    if (!g || typeof g !== "object" || Array.isArray(g)) continue;
    const gr = g as { op?: unknown; conditions?: unknown };
    if (!Array.isArray(gr.conditions)) continue;
    const conditions: FilterCondition[] = [];
    for (const c of gr.conditions.slice(0, MAX_CONDITIONS)) {
      const clean = sanitizeCondition(c);
      if (clean) conditions.push(clean);
    }
    if (conditions.length > 0) {
      groups.push({ op: gr.op === "or" ? "or" : "and", conditions });
    }
  }
  if (groups.length === 0) return null;
  return { op: r.op === "or" ? "or" : "and", groups };
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation — the reference semantics the SQL compiler must reproduce.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The flat, already-joined shape a filter runs over. Callers build this from a
 * Lead row plus whatever derived inputs they have (attempt columns, callback /
 * appointment join flags) — the evaluator never fetches anything itself.
 */
export interface LeadForFilter {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  city: string;
  state: string;
  county?: string | null;
  zip: string;
  timezone: string;
  status: string;
  campaignId: string;
  leadGroup?: string | null;
  leadPackId?: string | null;
  assignedRepId?: string | null;
  ownerId?: string | null;
  createdAt: string;
  lastContactedAt?: string | null;
  utilityBill?: number | null;
  solarPayment?: number | null;
  hasEV: boolean;
  hasPool: boolean;
  hasBattery: boolean;
  multipleSystems: boolean;
  customFields?: Record<string, unknown>;
  /** Digits-only phone — the canonical form DNC sets and search both use. */
  phoneDigits: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  latestOutcome?: string | null;
  hasOpenCallback?: boolean;
  hasScheduledAppointment?: boolean;
  archivedAt?: string | null;
  importJobId?: string | null;
  sourceFile?: string | null;
  dialingPreference?: string | null;
  nextEligibleAt?: string | null;
}

export interface FilterContext {
  now: Date;
  /** Canonical last-10-digit numbers on the org's DNC list (see db/dnc.ts). */
  dncDigits?: Set<string>;
}

const DAY_MS = 86_400_000;
// Mirror of db/leads DIALABLE — statuses still in play for outreach.
const DIALABLE_STATUSES = new Set(["new", "no_answer", "callback"]);
const TRUE_TOKENS = new Set(["true", "yes", "y", "1", "x"]);
const FALSE_TOKENS = new Set(["false", "no", "n", "0", ""]);

const last10 = (digits: string) => (digits.length >= 10 ? digits.slice(-10) : "");

function isPhoneValid(l: LeadForFilter): boolean {
  return l.phoneDigits.length >= 10 && l.phoneDigits.length <= 15;
}

function isOnDnc(l: LeadForFilter, ctx: FilterContext): boolean {
  if (l.status === "dnc") return true;
  const d = last10(l.phoneDigits);
  return Boolean(d && ctx.dncDigits?.has(d));
}

/**
 * "Could the dialer legally place this call right now" — valid phone, not on
 * the DNC list, not archived, a still-dialable status, and not snoozed into
 * the future. Status filtering beyond DIALABLE composes via the `status` key.
 */
function isDialEligible(l: LeadForFilter, ctx: FilterContext): boolean {
  if (!isPhoneValid(l) || isOnDnc(l, ctx)) return false;
  if (l.archivedAt != null) return false;
  if (!DIALABLE_STATUSES.has(l.status)) return false;
  if (l.nextEligibleAt) {
    const t = Date.parse(l.nextEligibleAt);
    if (!Number.isNaN(t) && t > ctx.now.getTime()) return false;
  }
  return true;
}

/** Numeric coercion with the SQL cast guard: non-numeric ⇒ NaN ⇒ no match. */
function coerceNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** Boolean coercion matching import-time parseFieldValue's token sets. */
function coerceBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (TRUE_TOKENS.has(v)) return true;
    if (FALSE_TOKENS.has(v)) return false;
  }
  return null;
}

function applyBooleanCmp(actual: boolean, cmp: FilterCmp): boolean {
  if (cmp === "is_true") return actual;
  if (cmp === "is_false") return !actual;
  return false;
}

function applyCmp(
  raw: unknown,
  family: FilterValueType,
  cmp: FilterCmp,
  value: FilterValue | undefined,
  now: Date,
): boolean {
  if (cmp === "is_empty") return raw == null || raw === "";
  if (cmp === "not_empty") return !(raw == null || raw === "");

  switch (family) {
    case "boolean": {
      const b = coerceBoolean(raw);
      if (b === null) return false;
      return applyBooleanCmp(b, cmp);
    }
    case "number": {
      const n = coerceNumber(raw);
      // The cast guard: even `neq` refuses to match a value that isn't a
      // number — mirroring SQL, where a failed cast excludes the row.
      if (!Number.isFinite(n)) return false;
      switch (cmp) {
        case "eq": return n === value;
        case "neq": return n !== value;
        case "gt": return n > (value as number);
        case "gte": return n >= (value as number);
        case "lt": return n < (value as number);
        case "lte": return n <= (value as number);
        case "between": {
          const [lo, hi] = value as [number, number];
          return n >= lo && n <= hi;
        }
        default: return false;
      }
    }
    case "date": {
      const t = raw == null || raw === "" ? NaN : Date.parse(String(raw));
      if (Number.isNaN(t)) return false;
      switch (cmp) {
        case "before": return t < Date.parse(value as string);
        case "after": return t > Date.parse(value as string);
        case "within_days": return Math.abs(now.getTime() - t) <= (value as number) * DAY_MS;
        case "older_than_days": return now.getTime() - t > (value as number) * DAY_MS;
        default: return false;
      }
    }
    default: {
      // text + enum: null reads as "" (SQL side: COALESCE(col, '')).
      const s = raw == null ? "" : String(raw);
      switch (cmp) {
        case "eq": return s === value;
        case "neq": return s !== value;
        case "in": return (value as string[]).includes(s);
        case "nin": return !(value as string[]).includes(s);
        case "contains":
          return s.toLowerCase().includes((value as string).toLowerCase());
        case "starts_with":
          return s.toLowerCase().startsWith((value as string).toLowerCase());
        default: return false;
      }
    }
  }
}

/**
 * The one free-text key: matches name OR city OR — when the query is
 * phone-shaped (digits and separators only) — the number's digits. A blank
 * query matches everything, same as no condition.
 */
function matchSearch(l: LeadForFilter, value: FilterValue | undefined): boolean {
  if (typeof value !== "string") return true;
  const q = value.trim().toLowerCase();
  if (!q) return true;
  if (`${l.firstName} ${l.lastName}`.toLowerCase().includes(q)) return true;
  if (l.city.toLowerCase().includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  const phoneShaped = digits.length > 0 && q.replace(/[\s().+-]/g, "") === digits;
  return phoneShaped && l.phoneDigits.includes(digits);
}

const CORE_GETTERS: Partial<Record<FilterFieldKey, (l: LeadForFilter) => unknown>> = {
  status: (l) => l.status,
  campaign_id: (l) => l.campaignId,
  lead_group: (l) => l.leadGroup,
  lead_pack_id: (l) => l.leadPackId,
  assigned_rep_id: (l) => l.assignedRepId,
  owner_id: (l) => l.ownerId,
  city: (l) => l.city,
  state: (l) => l.state,
  county: (l) => l.county,
  zip: (l) => l.zip,
  timezone: (l) => l.timezone,
  created_at: (l) => l.createdAt,
  last_contacted_at: (l) => l.lastContactedAt,
  utility_bill: (l) => l.utilityBill,
  solar_payment: (l) => l.solarPayment,
  has_ev: (l) => l.hasEV,
  has_pool: (l) => l.hasPool,
  has_battery: (l) => l.hasBattery,
  multiple_systems: (l) => l.multipleSystems,
  import_job_id: (l) => l.importJobId,
  source_file: (l) => l.sourceFile,
  dialing_preference: (l) => l.dialingPreference,
  attempt_count: (l) => l.attemptCount,
  last_attempt_at: (l) => l.lastAttemptAt,
  next_eligible_at: (l) => l.nextEligibleAt,
  latest_outcome: (l) => l.latestOutcome,
};

function evalCondition(l: LeadForFilter, c: FilterCondition, ctx: FilterContext): boolean {
  if (c.kind === "custom") {
    const family = CUSTOM_TYPE_FAMILY[c.type];
    return applyCmp(l.customFields?.[c.key], family, c.cmp, c.value, ctx.now);
  }
  switch (c.key) {
    case "search": return matchSearch(l, c.value);
    case "phone_valid": return applyBooleanCmp(isPhoneValid(l), c.cmp);
    case "dnc": return applyBooleanCmp(isOnDnc(l, ctx), c.cmp);
    case "never_dialed":
      return applyBooleanCmp(l.attemptCount === 0 && !l.lastAttemptAt, c.cmp);
    case "dial_eligible": return applyBooleanCmp(isDialEligible(l, ctx), c.cmp);
    case "unassigned": return applyBooleanCmp(!l.assignedRepId, c.cmp);
    case "archived": return applyBooleanCmp(l.archivedAt != null, c.cmp);
    case "has_open_callback": return applyBooleanCmp(l.hasOpenCallback === true, c.cmp);
    case "has_scheduled_appointment":
      return applyBooleanCmp(l.hasScheduledAppointment === true, c.cmp);
    default: {
      const get = CORE_GETTERS[c.key];
      if (!get) return false;
      return applyCmp(get(l), FILTER_FIELD_TYPES[c.key], c.cmp, c.value, ctx.now);
    }
  }
}

/**
 * Run a (sanitized) spec over one lead. Group op combines its conditions; the
 * spec op combines the groups. An empty list at either level matches — the
 * sanitizer never emits one, but "no constraints" must mean "everything."
 */
export function evaluateFilter(
  lead: LeadForFilter,
  spec: FilterSpec,
  ctx: FilterContext,
): boolean {
  const evalGroup = (g: FilterGroup): boolean => {
    if (g.conditions.length === 0) return true;
    return g.op === "and"
      ? g.conditions.every((c) => evalCondition(lead, c, ctx))
      : g.conditions.some((c) => evalCondition(lead, c, ctx));
  };
  if (spec.groups.length === 0) return true;
  return spec.op === "and" ? spec.groups.every(evalGroup) : spec.groups.some(evalGroup);
}

// ─────────────────────────────────────────────────────────────────────────────
// URL codec — a spec as one base64url query param, shareable and bookmarkable.
// ─────────────────────────────────────────────────────────────────────────────

/** Hard cap on the encoded param — beyond this, URLs start getting truncated
 *  by proxies and chat apps, so we refuse to emit rather than emit a lie. */
export const MAX_FILTER_PARAM_CHARS = 4096;

// Node has Buffer, browsers have btoa/atob; neither global exists in the other
// runtime, so both paths are reached only behind a presence check — and typed
// via globalThis so this module compiles without either lib assumption.
type BufferLike = {
  from(input: string, encoding: string): { toString(encoding: string): string };
};
const runtime = globalThis as {
  Buffer?: BufferLike;
  btoa?: (s: string) => string;
  atob?: (s: string) => string;
};

function utf8ToBase64(json: string): string | null {
  if (runtime.Buffer) return runtime.Buffer.from(json, "utf8").toString("base64");
  // The percent-encoding trick keeps btoa UTF-8-safe without TextEncoder.
  if (runtime.btoa) return runtime.btoa(unescape(encodeURIComponent(json)));
  return null;
}

function base64ToUtf8(b64: string): string | null {
  if (runtime.Buffer) return runtime.Buffer.from(b64, "base64").toString("utf8");
  if (runtime.atob) return decodeURIComponent(escape(runtime.atob(b64)));
  return null;
}

/** Spec → base64url param. "" when the spec can't be encoded or is too big. */
export function encodeFilterParam(spec: FilterSpec): string {
  const b64 = utf8ToBase64(JSON.stringify(spec));
  if (b64 === null) return "";
  const param = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return param.length > MAX_FILTER_PARAM_CHARS ? "" : param;
}

/** Param → sanitized spec. null on any garbage — never throws. */
export function decodeFilterParam(s: string): FilterSpec | null {
  if (!s || s.length > MAX_FILTER_PARAM_CHARS || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const json = base64ToUtf8(padded);
    if (json === null) return null;
    return sanitizeFilterSpec(JSON.parse(json));
  } catch {
    return null;
  }
}
