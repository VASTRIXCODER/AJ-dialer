// ─────────────────────────────────────────────────────────────────────────────
// Teleprompter text engine — PURE (no React, no DOM) so interpolation and
// section-splitting are unit-testable and the component only renders verdicts.
//
// A campaign script is plain text the admin wrote. Two things happen to it:
//
//  1. SECTIONS — split on markdown-ish headings (`# Heading`, `## Heading`,
//     `**Heading**`) when the author used any, otherwise on blank-line groups.
//     Sections drive the sidebar nav so a rep can jump mid-call.
//
//  2. {{field}} INTERPOLATION — placeholders resolve against the org's OWN
//     resolved field schema (resolveLeadFields output) + the current lead, by
//     key or label, case/spacing-insensitively. A field with no value renders
//     as a MISSING token — the component draws an amber ⟨field name⟩ chip —
//     and NEVER a guessed or invented value: a rep reading a script aloud must
//     be able to trust every word on the pane, so an unknown is shown as an
//     unknown.
// ─────────────────────────────────────────────────────────────────────────────

import {
  formatFieldValue,
  leadFieldValue,
  type LeadFieldDef,
} from "@/lib/leads/field-schema";
import type { Lead } from "@/lib/types";

export type ScriptToken =
  | { kind: "text"; text: string }
  | {
      kind: "field";
      /** Resolved schema key, or the normalized placeholder when unmatched. */
      key: string;
      /** What the chip shows: the schema label, or the raw placeholder text. */
      label: string;
      /** Formatted value, or null when the lead has no value (missing chip). */
      value: string | null;
    };

export interface ScriptSection {
  title: string;
  tokens: ScriptToken[];
}

/** Lowercase, strip everything non-alphanumeric — "First Name" ≡ firstName. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** `# H` / `## H` / `**H**` / `__H__` on a line of its own. */
const MD_HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const BOLD_HEADING = /^(?:\*\*([^*]+)\*\*|__([^_]+)__)\s*$/;

function headingTitle(line: string): string | null {
  const md = MD_HEADING.exec(line.trim());
  if (md) return md[1].trim();
  const bold = BOLD_HEADING.exec(line.trim());
  if (bold) return (bold[1] ?? bold[2]).trim();
  return null;
}

/** A nav title for an untitled block: its first line, truncated. */
function titleFromBody(body: string, index: number): string {
  const first = body.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!first) return `Part ${index + 1}`;
  return first.length > 34 ? `${first.slice(0, 33).trimEnd()}…` : first;
}

/**
 * Split a script into navigable sections. Headings win when present (text
 * before the first heading becomes an "Opening" section); otherwise blank-line
 * groups each become a section titled by their first line. A script with no
 * breaks at all is one section.
 */
export function splitScriptSections(
  text: string,
): { title: string; body: string }[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);

  const marks: { line: number; title: string }[] = [];
  lines.forEach((line, i) => {
    const title = headingTitle(line);
    if (title) marks.push({ line: i, title });
  });

  if (marks.length > 0) {
    const sections: { title: string; body: string }[] = [];
    const preface = lines
      .slice(0, marks[0].line)
      .join("\n")
      .trim();
    if (preface) sections.push({ title: "Opening", body: preface });
    marks.forEach((mark, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].line : lines.length;
      const body = lines
        .slice(mark.line + 1, end)
        .join("\n")
        .trim();
      sections.push({ title: mark.title, body });
    });
    return sections;
  }

  const groups = trimmed
    .split(/\n\s*\n+/)
    .map((g) => g.trim())
    .filter(Boolean);
  return groups.map((body, i) => ({ title: titleFromBody(body, i), body }));
}

/**
 * Identity slots scripts routinely reference ({{firstName}}, {{city}}, …).
 * They live directly on Lead but NOT in the org's resolved field schema
 * (resolveLeadFields covers the relabelable/custom slots only), so the
 * teleprompter extends the schema with these — schema fields always win when
 * keys collide. Labels are vertical-neutral by construction.
 */
export const IDENTITY_SCRIPT_FIELDS: LeadFieldDef[] = [
  { key: "firstName", label: "First name", type: "text", source: "core", showInTable: false, showInQualify: false },
  { key: "lastName", label: "Last name", type: "text", source: "core", showInTable: false, showInQualify: false },
  { key: "address", label: "Address", type: "text", source: "core", showInTable: false, showInQualify: false },
  { key: "city", label: "City", type: "text", source: "core", showInTable: false, showInQualify: false },
  { key: "state", label: "State", type: "text", source: "core", showInTable: false, showInQualify: false },
  { key: "zip", label: "ZIP", type: "text", source: "core", showInTable: false, showInQualify: false },
  { key: "phone", label: "Phone", type: "phone", source: "core", showInTable: false, showInQualify: false },
  { key: "email", label: "Email", type: "email", source: "core", showInTable: false, showInQualify: false },
];

/** The org schema extended with identity slots (schema wins on collision). */
export function scriptFieldSchema(fields: LeadFieldDef[]): LeadFieldDef[] {
  const seen = new Set(fields.map((f) => normalizeName(f.key)));
  return [
    ...fields,
    ...IDENTITY_SCRIPT_FIELDS.filter((f) => !seen.has(normalizeName(f.key))),
  ];
}

/** Find the schema field a placeholder names — by key first, then by label. */
export function matchScriptField(
  name: string,
  fields: LeadFieldDef[],
): LeadFieldDef | null {
  const norm = normalizeName(name);
  if (!norm) return null;
  return (
    fields.find((f) => normalizeName(f.key) === norm) ??
    fields.find((f) => normalizeName(f.label) === norm) ??
    null
  );
}

const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Tokenize one section body: plain text runs plus field tokens. A matched
 * field with a real value carries its formatted value; anything else (unknown
 * placeholder, empty value, boolean false, the "—" display dash) is a MISSING
 * token — value null, never a substitute.
 */
export function interpolateScript(
  body: string,
  lead: Lead | null,
  fields: LeadFieldDef[],
): ScriptToken[] {
  const tokens: ScriptToken[] = [];
  const text = body ?? "";
  const schema = scriptFieldSchema(fields);
  let last = 0;
  // Fresh regex state per call (the module-level literal keeps lastIndex).
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ kind: "text", text: text.slice(last, m.index) });
    const rawName = m[1].trim();
    const def = matchScriptField(rawName, schema);
    if (!def) {
      tokens.push({ kind: "field", key: normalizeName(rawName), label: rawName, value: null });
    } else {
      const raw = lead ? leadFieldValue(lead, def) : null;
      const formatted =
        raw == null || raw === "" || raw === false
          ? null
          : formatFieldValue(raw, def.type);
      const value = formatted && formatted !== "—" ? formatted : null;
      tokens.push({ kind: "field", key: def.key, label: def.label, value });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}

/** Sections + interpolation in one pass — what the component renders. */
export function buildTeleprompterSections(
  text: string,
  lead: Lead | null,
  fields: LeadFieldDef[],
): ScriptSection[] {
  return splitScriptSections(text).map((s) => ({
    title: s.title,
    tokens: interpolateScript(s.body, lead, fields),
  }));
}
