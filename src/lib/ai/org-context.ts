// ─────────────────────────────────────────────────────────────────────────────
// Org AI context — the single "who is this org and what do they track?" shape
// every AI surface derives from, replacing the boolean `isSolar` that six API
// routes used to compute independently. PURE + isomorphic (no DB, no
// server-only): consumed by the Claude services, the demo simulators, the
// ElevenLabs prompt builder, and the API routes alike.
//
// The field schema comes from resolveLeadFields (org settings.leadFields when
// saved, else the vertical template's relabels/hides of the core solar-era
// slots) — so prompts and simulators speak in the org's own labels ("Current
// premium ($/mo)") rather than someone else's industry.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type CoreFieldOverrides,
  type LeadFieldDef,
  type LeadFieldType,
  formatFieldValue,
  leadFieldValue,
  resolveLeadFields,
} from "../leads/field-schema";
import { type TemplateProfile, templateProfile } from "../org/templates";
import { isSolarVertical } from "../org/vertical";
import type { Lead } from "../types";

export interface OrgAIContext {
  /** Does this org sell against a solar loan/lease? Gates all solar copy. */
  isSolar: boolean;
  /** The org's dialer template (vertical), e.g. "solar", "insurance". */
  template: string;
  /** Domain noun for a contact, e.g. "homeowner", "policyholder". */
  leadNoun: string;
  leadNounPlural: string;
  /** The org's effective lead field schema (template-hidden core slots removed). */
  fields: LeadFieldDef[];
}

/**
 * The minimal org shape the context derives from — structurally satisfied by
 * `Viewer["org"]` (OrgFull), `AgentOrgLike`, and the webhook's org rows alike.
 */
export interface OrgContextSource {
  dialerTemplate?: string | null;
  settings?: {
    leadFields?: LeadFieldDef[];
    leadNoun?: string;
    leadNounPlural?: string;
  } | null;
}

/**
 * Template-level core-slot overrides, when the template defines them. This is
 * defensive on purpose: `TemplateProfile.fields` is introduced by the dialer
 * config work and may not exist in every tree — absent overrides fall back to
 * NON_SOLAR_FALLBACK_OVERRIDES for non-solar templates below.
 */
function templateFieldOverrides(profile: TemplateProfile): CoreFieldOverrides | undefined {
  const withFields = profile as TemplateProfile & { fields?: CoreFieldOverrides };
  return withFields.fields && typeof withFields.fields === "object"
    ? withFields.fields
    : undefined;
}

/**
 * The floor for a NON-solar template that defines no field overrides (and an
 * org that saved none): the AI must not speak solar's vocabulary, so the
 * solar-specific slots are hidden and the money slot reads neutrally. A
 * template's own `fields` presets (or org-saved core defs) win over this.
 */
const NON_SOLAR_FALLBACK_OVERRIDES: CoreFieldOverrides = {
  labels: {
    utilityBill: "Monthly bill ($/mo)",
    utilityProvider: "Current provider",
  },
  hidden: ["solarPayment", "solarProvider", "hasBattery", "multipleSystems"],
};

/**
 * Build the AI context for an organization. `null`/`undefined` (demo mode, no
 * org row) preserves the historical default: the solar context — the same
 * fallback every route's old `viewer.org ? … : true` expressed.
 */
export function orgAIContext(org: OrgContextSource | null | undefined): OrgAIContext {
  const template = org ? String(org.dialerTemplate || "general") : "solar";
  const solar = isSolarVertical(template);
  const profile = templateProfile(template);
  const overrides =
    templateFieldOverrides(profile) ??
    (solar ? undefined : NON_SOLAR_FALLBACK_OVERRIDES);
  const settings = org?.settings ?? undefined;

  // The org's explicit noun wins; the stored default ("lead") falls through to
  // the template's noun so a solar org that never touched Terminology still
  // reads "homeowner" rather than the generic seed value.
  const noun = (settings?.leadNoun ?? "").trim();
  const nounPlural = (settings?.leadNounPlural ?? "").trim();

  // Template-hidden core slots are dropped outright: the AI must never speak a
  // field the org's vertical hides (insurance never hears "Solar payment").
  // An explicit org-saved core def wins over the template hide, mirroring
  // resolveLeadFields' own precedence.
  const savedCore = new Set(
    (settings?.leadFields ?? [])
      .filter((f) => f && f.source === "core")
      .map((f) => f.key),
  );
  const hidden = new Set(overrides?.hidden ?? []);
  const fields = resolveLeadFields(settings?.leadFields, overrides).filter(
    (f) => f.source !== "core" || !hidden.has(f.key) || savedCore.has(f.key),
  );

  return {
    isSolar: solar,
    template,
    leadNoun: noun && noun !== "lead" ? noun : profile.leadNoun,
    leadNounPlural:
      nounPlural && nounPlural !== "leads" ? nounPlural : profile.leadNounPlural,
    fields,
  };
}

/**
 * Back-compat shim for callers that still pass the boolean `isSolar` and no
 * context: the two historical poles — the solar context and the general one.
 */
export function defaultAIContext(isSolar = true): OrgAIContext {
  return orgAIContext(isSolar ? null : { dialerTemplate: "general" });
}

/** One serialized lead field: the org's label, its type, and the typed value. */
export interface LeadFieldEntry {
  key: string;
  label: string;
  type: LeadFieldType;
  /** Raw typed value; null when the lead has nothing for this field. */
  value: string | number | boolean | null;
}

/** "policy_expiry" → "Policy Expiry" for custom values the schema hasn't met. */
function prettifyKey(key: string): string {
  return key
    .replace(/_+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Serialize a lead's data through the org's field schema: every schema field
 * (labels + typed values, null when unknown) plus any custom_fields values the
 * lead carries that the schema hasn't captured yet — real org data either way.
 * Fields the template hides never appear (orgAIContext already dropped them).
 */
export function leadSchemaEntries(lead: Lead, ctx: OrgAIContext): LeadFieldEntry[] {
  const entries: LeadFieldEntry[] = [];
  const seen = new Set<string>();
  for (const def of ctx.fields) {
    seen.add(def.key);
    const v = leadFieldValue(lead, def);
    entries.push({
      key: def.key,
      label: def.label,
      type: def.type,
      value: v == null || v === "" ? null : v,
    });
  }
  for (const [key, v] of Object.entries(lead.customFields ?? {})) {
    if (seen.has(key) || v == null || v === "") continue;
    entries.push({
      key,
      label: prettifyKey(key),
      type: typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "text",
      value: v,
    });
  }
  return entries;
}

/**
 * Human-readable "Label: value" lines for the fields a lead actually has —
 * what the demo simulators quote so their copy speaks the org's schema.
 */
export function leadFieldSummaryLines(lead: Lead, ctx: OrgAIContext): string[] {
  return leadSchemaEntries(lead, ctx)
    .filter((e) => e.value != null && e.value !== false)
    .map((e) => `${e.label}: ${formatFieldValue(e.value, e.type)}`);
}

/** "Utility bill ($/mo)" → "utility bill" — a label fit for spoken phrasing. */
export function spokenFieldLabel(label: string): string {
  const spoken = label.replace(/\s*\([^)]*\)/g, "").trim();
  return spoken || label.trim();
}

/**
 * A type-appropriate qualifying question for one schema field — how both the
 * voice agent's white-label prompt and the demo copilot phrase "go capture
 * this field" in the org's own vocabulary.
 */
export function qualifyingQuestion(def: LeadFieldDef): string {
  const label = spokenFieldLabel(def.label);
  // Sentence-case the label for mid-sentence use — but leave acronyms alone
  // ("EV" must never become "eV").
  const lower = /^[A-Z]{2}/.test(label)
    ? label
    : label.charAt(0).toLowerCase() + label.slice(1);
  switch (def.type) {
    case "currency":
      return `What does your ${lower} come to in a typical month?`;
    case "number":
      return `What's your current ${lower}?`;
    case "boolean": {
      if (/s$/i.test(label)) return `Do you have ${lower}?`;
      const article = /^[aeiou]/i.test(label) ? "an" : "a";
      return `Do you have ${article} ${lower}?`;
    }
    case "date":
      return `When is your ${lower}?`;
    case "phone":
      return `What's the best number to reach you on?`;
    case "email":
      return `What's the best email address for you?`;
    default:
      return `Can you confirm your ${lower} for me?`;
  }
}
