import type { CustomCapture, Field } from "@/lib/leads/csv";
import {
  normalizeFieldKey,
  RESERVED_FIELD_KEYS,
  type LeadFieldDef,
  type LeadFieldType,
} from "@/lib/leads/field-schema";
import type { ColumnPlan } from "@/lib/leads/parse-request";

// ─────────────────────────────────────────────────────────────────────────────
// Import Studio ← → ColumnPlan translation. PURE (no React, no server deps):
// the mapping step edits ColumnTarget[] and this converts to/from the plan the
// import API replays on every chunk. Whatever kind of plan PROPOSED the mapping
// (deterministic headers or the AI head-to-head), the wizard always EMITS a
// headers-kind plan — the human has confirmed each column, so the deterministic
// replay is now the correct reading of the file by construction.
// ─────────────────────────────────────────────────────────────────────────────

export type ColumnTarget =
  | { kind: "core"; field: Exclude<Field, null> }
  | { kind: "custom"; label: string; type: LeadFieldType }
  | { kind: "dnc" }
  | { kind: "dialPref" }
  | { kind: "ignore" };

/** What /api/leads/import/inspect returns per column. */
export interface InspectedColumn {
  index: number;
  header: string;
  samples: string[];
  proposal:
    | { kind: "core"; field: string }
    | { kind: "custom"; key: string; label: string; type: string }
    | { kind: "dnc" }
    | { kind: "ignore" };
  confidence: "high" | "medium" | "low";
}

/** Every core field a CSV column may map onto, in menu order. */
const CORE_FIELDS: Exclude<Field, null>[] = [
  "phone", "firstName", "lastName", "name", "email", "address", "address2",
  "city", "state", "zip", "utilityBill", "solarPayment", "utilityProvider",
  "solarProvider", "notes",
];

const CORE_SET = new Set<string>(CORE_FIELDS);

const FIELD_TYPES = new Set<LeadFieldType>([
  "text", "number", "currency", "boolean", "date", "phone", "email", "url",
]);

/**
 * Menu options for the target select. The four relabelable core slots read the
 * ORG'S OWN labels (resolveLeadFields output) — an insurance workspace maps a
 * column to "Current premium ($/mo)", never to solar's words. Everything else
 * is vertical-neutral by construction.
 */
export function coreTargetOptions(
  fields: LeadFieldDef[],
): { field: Exclude<Field, null>; label: string }[] {
  const orgLabel = (key: string, fallback: string) =>
    fields.find((f) => f.key === key)?.label ?? fallback;
  const labels: Record<string, string> = {
    phone: "Phone",
    firstName: "First name",
    lastName: "Last name",
    name: "Full name (one column)",
    email: "Email",
    address: "Street address",
    address2: "Address line 2 / unit",
    city: "City",
    state: "State",
    zip: "ZIP",
    notes: "Notes",
    utilityBill: orgLabel("utilityBill", "Utility bill ($/mo)"),
    solarPayment: orgLabel("solarPayment", "Solar payment ($/mo)"),
    utilityProvider: orgLabel("utilityProvider", "Utility provider"),
    solarProvider: orgLabel("solarProvider", "Solar provider"),
  };
  return CORE_FIELDS.map((field) => ({ field, label: labels[field] ?? field }));
}

/** Seed the mapping step's editable targets from the inspection's proposals. */
export function targetsFromInspection(columns: InspectedColumn[]): ColumnTarget[] {
  return columns.map((c): ColumnTarget => {
    const p = c.proposal;
    if (p.kind === "core" && CORE_SET.has(p.field)) {
      return { kind: "core", field: p.field as Exclude<Field, null> };
    }
    if (p.kind === "custom") {
      const type = FIELD_TYPES.has(p.type as LeadFieldType)
        ? (p.type as LeadFieldType)
        : "text";
      return { kind: "custom", label: p.label || c.header, type };
    }
    if (p.kind === "dnc") return { kind: "dnc" };
    return { kind: "ignore" };
  });
}

/**
 * The plan the run step sends with every chunk. Duplicate/reserved/blank custom
 * keys are dropped here exactly as the server's sanitizer would drop them, so
 * what the user sees saved is what actually applies.
 */
export function buildHeadersPlan(
  targets: ColumnTarget[],
  hasHeader: boolean,
  headers: string[],
): ColumnPlan {
  const header: Field[] = targets.map((t) => (t.kind === "core" ? t.field : null));
  const captures: CustomCapture[] = [];
  const seen = new Set<string>();
  let dncCol: number | undefined;
  let dialPrefCol: number | undefined;
  targets.forEach((t, col) => {
    if (t.kind === "custom") {
      const label = (t.label || headers[col] || `Column ${col + 1}`).trim().slice(0, 80);
      const key = normalizeFieldKey(label);
      if (!key || seen.has(key) || RESERVED_FIELD_KEYS.has(key)) return;
      seen.add(key);
      captures.push({ col, key, label, type: t.type });
    } else if (t.kind === "dnc" && dncCol === undefined) {
      dncCol = col;
    } else if (t.kind === "dialPref" && dialPrefCol === undefined) {
      dialPrefCol = col;
    }
  });
  return {
    kind: "headers",
    header,
    captures,
    hasHeader,
    ...(dncCol !== undefined ? { dncCol } : {}),
    ...(dialPrefCol !== undefined ? { dialPrefCol } : {}),
  };
}

/** Re-apply a saved template (a headers-kind plan) onto this file's columns. */
export function targetsFromPlan(
  plan: ColumnPlan | null | undefined,
  width: number,
): ColumnTarget[] | null {
  if (!plan || plan.kind !== "headers") return null;
  const targets: ColumnTarget[] = Array.from({ length: width }, () => ({
    kind: "ignore",
  }));
  plan.header.forEach((field, i) => {
    if (field && i < width && CORE_SET.has(field)) {
      targets[i] = { kind: "core", field };
    }
  });
  for (const cap of plan.captures) {
    if (cap.col < width) {
      targets[cap.col] = { kind: "custom", label: cap.label, type: cap.type };
    }
  }
  if (plan.dncCol !== undefined && plan.dncCol >= 0 && plan.dncCol < width) {
    targets[plan.dncCol] = { kind: "dnc" };
  }
  if (
    plan.dialPrefCol !== undefined &&
    plan.dialPrefCol >= 0 &&
    plan.dialPrefCol < width
  ) {
    targets[plan.dialPrefCol] = { kind: "dialPref" };
  }
  return targets;
}
