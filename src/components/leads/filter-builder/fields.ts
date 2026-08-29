import type { LeadFieldDef, LeadFieldType } from "@/lib/leads/field-schema";
import {
  FILTER_CMPS_BY_TYPE,
  FILTER_FIELD_TYPES,
  type FilterCmp,
  type FilterCondition,
  type FilterFieldKey,
  type FilterValueType,
} from "@/lib/leads/filter-spec";

// ─────────────────────────────────────────────────────────────────────────────
// The filter builder's field catalog — PURE (no React), so the option list is
// testable and the builder component stays layout-only.
//
// Three groups, one precedence:
//   Standard — fixed platform columns (status, geography, dates, attempts) plus
//     the relabelable core slots, whose LABELS come from the org's resolved
//     schema (`fields` prop) — never hardcoded here, per the vocabulary rule.
//   Custom   — the org's own imported fields (leads.custom_fields).
//   Activity — derived predicates with plain-language labels ("Never dialed",
//     "On DNC list") — the conditions reps actually think in.
//
// Every option carries its comparator FAMILY straight from FILTER_FIELD_TYPES,
// so the operator dropdown can never offer a comparator the sanitizer (and the
// SQL compiler) would reject.
// ─────────────────────────────────────────────────────────────────────────────

/** Which value control a condition renders. "none" = the cmp carries it all. */
export type FieldInput =
  | "text"
  | "number"
  | "date"
  | "status"
  | "campaign"
  | "rep"
  | "dialpref"
  | "none";

export type FieldGroup = "standard" | "custom" | "activity";

export interface FieldOption {
  /** Stable select value — `${kind}:${key}`. */
  id: string;
  label: string;
  group: FieldGroup;
  kind: "core" | "derived" | "custom";
  key: string;
  family: FilterValueType;
  /** Present only for custom fields — travels on the FilterCondition. */
  customType?: LeadFieldType;
  input: FieldInput;
}

export const FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  standard: "Standard",
  custom: "Custom fields",
  activity: "Activity",
};

/** Core Lead slots (camelCase schema keys) → their filter column keys. The
 *  provider slots have no filter key yet, so they're deliberately absent. */
const CORE_SLOT_TO_FILTER_KEY: Record<string, FilterFieldKey> = {
  utilityBill: "utility_bill",
  solarPayment: "solar_payment",
  hasEV: "has_ev",
  hasPool: "has_pool",
  hasBattery: "has_battery",
  multipleSystems: "multiple_systems",
};

/** Import-time custom types → comparator family (mirror of the sanitizer's). */
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

function core(
  key: FilterFieldKey,
  label: string,
  input?: FieldInput,
): FieldOption {
  const family = FILTER_FIELD_TYPES[key];
  return {
    id: `core:${key}`,
    label,
    group: "standard",
    kind: "core",
    key,
    family,
    input: input ?? (family === "boolean" ? "none" : family === "date" ? "date" : family === "number" ? "number" : "text"),
  };
}

function derived(key: FilterFieldKey, label: string): FieldOption {
  const family = FILTER_FIELD_TYPES[key];
  return {
    id: `derived:${key}`,
    label,
    group: "activity",
    kind: "derived",
    key,
    family,
    input: family === "boolean" ? "none" : "text",
  };
}

/**
 * Build the full option list for one org. `fields` is the org's RESOLVED lead
 * schema (resolveLeadFields) — core slot labels and every custom field come
 * from it, so an insurance org sees "Current premium", never "Utility bill".
 */
export function buildFieldCatalog(fields: LeadFieldDef[]): FieldOption[] {
  const out: FieldOption[] = [
    core("status", "Status", "status"),
    core("campaign_id", "Campaign", "campaign"),
    core("assigned_rep_id", "Assigned rep", "rep"),
    core("address", "Address"),
    core("city", "City"),
    core("state", "State"),
    core("county", "County"),
    core("zip", "ZIP"),
    core("timezone", "Timezone"),
    core("created_at", "Created"),
    core("last_contacted_at", "Last contacted"),
    core("attempt_count", "Dial attempts"),
    core("last_attempt_at", "Last attempt"),
    core("next_eligible_at", "Next eligible"),
    core("dialing_preference", "Dialing preference", "dialpref"),
    core("source_file", "Source file"),
  ];

  for (const def of fields) {
    if (def.source === "core") {
      const key = CORE_SLOT_TO_FILTER_KEY[def.key];
      if (key) out.push(core(key, def.label));
      continue;
    }
    const family = CUSTOM_TYPE_FAMILY[def.type];
    out.push({
      id: `custom:${def.key}`,
      label: def.label,
      group: "custom",
      kind: "custom",
      key: def.key,
      family,
      customType: def.type,
      input:
        family === "boolean"
          ? "none"
          : family === "date"
            ? "date"
            : family === "number"
              ? "number"
              : "text",
    });
  }

  out.push(
    derived("never_dialed", "Never dialed"),
    derived("dnc", "On DNC list"),
    derived("phone_valid", "Valid phone"),
    derived("dial_eligible", "Dial-eligible now"),
    derived("latest_outcome", "Latest outcome"),
    derived("has_open_callback", "Has open callback"),
    derived("has_scheduled_appointment", "Has scheduled appointment"),
    derived("unassigned", "Unassigned"),
    derived("archived", "Archived"),
  );

  return out;
}

/** UI-offered comparators, in display order, per family. Filtered through the
 *  sanitizer's own whitelist so the two can never drift apart. */
const OFFERED: Record<FilterValueType, FilterCmp[]> = {
  text: ["contains", "eq", "neq", "starts_with", "is_empty", "not_empty"],
  enum: ["eq", "neq", "is_empty", "not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"],
  boolean: ["is_true", "is_false"],
  date: ["before", "after", "within_days", "older_than_days", "is_empty", "not_empty"],
};

export function cmpsFor(family: FilterValueType): FilterCmp[] {
  return OFFERED[family].filter((c) => FILTER_CMPS_BY_TYPE[family].has(c));
}

export const CMP_LABELS: Record<FilterCmp, string> = {
  eq: "is",
  neq: "is not",
  in: "is any of",
  nin: "is none of",
  contains: "contains",
  starts_with: "starts with",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  between: "between",
  is_empty: "is empty",
  not_empty: "is not empty",
  is_true: "is yes",
  is_false: "is no",
  before: "before",
  after: "after",
  within_days: "in the last … days",
  older_than_days: "older than … days",
};

/** Comparators that render no value control at all. */
export const VALUELESS_CMPS: ReadonlySet<FilterCmp> = new Set([
  "is_empty",
  "not_empty",
  "is_true",
  "is_false",
]);

/** Resolve the catalog entry an existing condition belongs to. */
export function fieldOptionFor(
  catalog: FieldOption[],
  cond: FilterCondition,
): FieldOption | undefined {
  const kind = cond.kind === "custom" ? "custom" : undefined;
  return catalog.find((f) =>
    kind ? f.kind === "custom" && f.key === cond.key : f.kind !== "custom" && f.key === cond.key,
  );
}

/** A fresh condition for a just-picked field: first legal cmp + a sane value. */
export function defaultCondition(
  field: FieldOption,
  opts: {
    statusOptions: { value: string }[];
    campaignOptions: { id: string }[];
    repOptions: { id: string }[];
  },
): FilterCondition {
  const cmp = cmpsFor(field.family)[0] ?? "eq";
  const value = defaultValue(field, cmp, opts);
  const base =
    field.kind === "custom"
      ? { kind: "custom" as const, key: field.key, type: field.customType ?? "text", cmp }
      : { kind: field.kind, key: field.key as FilterFieldKey, cmp };
  return value === undefined ? base : { ...base, value };
}

export function defaultValue(
  field: FieldOption,
  cmp: FilterCmp,
  opts: {
    statusOptions: { value: string }[];
    campaignOptions: { id: string }[];
    repOptions: { id: string }[];
  },
): FilterCondition["value"] {
  if (VALUELESS_CMPS.has(cmp)) return undefined;
  if (cmp === "between") return [0, 0];
  if (cmp === "within_days" || cmp === "older_than_days") return 7;
  if (cmp === "before" || cmp === "after") {
    return new Date().toISOString().slice(0, 10);
  }
  if (field.family === "number") return 0;
  switch (field.input) {
    case "status":
      return opts.statusOptions[0]?.value ?? "";
    case "campaign":
      return opts.campaignOptions[0]?.id ?? "";
    case "rep":
      return opts.repOptions[0]?.id ?? "";
    case "dialpref":
      return "either";
    default:
      return "";
  }
}

/** Dialing-preference stored keys with plain labels — keys never move. */
export const DIALING_PREFERENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "either", label: "Either" },
  { value: "ai", label: "AI only" },
  { value: "manual", label: "Manual only" },
  { value: "none", label: "Do not dial" },
];
