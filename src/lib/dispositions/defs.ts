// ─────────────────────────────────────────────────────────────────────────────
// Disposition taxonomy — PURE module (no server-only), importable from both
// Client and Server Components.
//
// The Admin "Dispositions" editor has always edited `settings.dispositions`
// ({ label, tone }[]) — a list nothing else ever read. The wrap-up buttons,
// the metrics queries, and the lead-status writer all key off the nine
// canonical CallOutcome strings instead, so an admin could rename, add, or
// delete rows all day and the dialer wouldn't change.
//
// This module gives every disposition a stable KEY and a BEHAVIOR so the
// editor can become real: the key is what's stored on call records (for the
// nine system rows it IS the CallOutcome, which can never move — bills_fine,
// do_not_call, … are on live rows), and the behavior says what pressing the
// button actually does to the lead. Custom rows get an `x_`-prefixed key so
// they can never collide with a canonical outcome, today's or a future one.
// ─────────────────────────────────────────────────────────────────────────────

import type { DispositionTone } from "@/lib/org/settings";
import type { CallOutcome } from "@/lib/types";

/**
 * What selecting a disposition DOES — the pipeline effect, decoupled from the
 * words on the button. An admin can rename "Appointment booked" to "Meeting
 * set" or add a custom "Left with spouse" row, but the dialer only ever acts
 * on the behavior, and every behavior lands on a canonical stored outcome.
 */
export type DispositionBehavior =
  | "books_appointment"
  | "schedules_callback"
  | "marks_dnc"
  | "marks_qualified"
  | "not_interested"
  | "no_need"
  | "no_answer_retry"
  | "voicemail_retry"
  | "invalid_number"
  | "neutral_end";

/**
 * Behavior → the CallOutcome stored on the call record. Total over the union
 * so a custom disposition with ANY behavior always resolves to a key the
 * metrics, archive search, and lead-status writer already understand —
 * no new stored outcome values, ever. `neutral_end` is the catch-all for
 * custom rows that just end the call; it deliberately reuses an existing
 * outcome rather than inventing a tenth stored key.
 */
export const BEHAVIOR_TO_OUTCOME: Record<DispositionBehavior, CallOutcome> = {
  books_appointment: "appointment_booked",
  schedules_callback: "callback_scheduled",
  marks_dnc: "do_not_call",
  marks_qualified: "qualified",
  not_interested: "not_interested",
  no_need: "bills_fine",
  no_answer_retry: "no_answer",
  voicemail_retry: "voicemail",
  invalid_number: "wrong_number",
  neutral_end: "not_interested",
};

export interface DispositionDef {
  /** Stored key. For system rows this IS the CallOutcome; custom rows are `x_*`. */
  key: string;
  label: string;
  tone: DispositionTone;
  behavior: DispositionBehavior;
  enabled: boolean;
  /** System rows map 1:1 to a canonical CallOutcome and can't be deleted. */
  system: boolean;
  sortOrder: number;
}

/**
 * Outcome → its primary behavior. Built by inverting BEHAVIOR_TO_OUTCOME with
 * first-wins so `not_interested` (the outcome) reads back as `not_interested`
 * (the behavior), not the `neutral_end` alias that happens to share its
 * stored key.
 */
const OUTCOME_TO_BEHAVIOR: Partial<Record<CallOutcome, DispositionBehavior>> = {};
for (const [behavior, outcome] of Object.entries(BEHAVIOR_TO_OUTCOME) as [
  DispositionBehavior,
  CallOutcome,
][]) {
  if (!OUTCOME_TO_BEHAVIOR[outcome]) OUTCOME_TO_BEHAVIOR[outcome] = behavior;
}

/**
 * The nine canonical dispositions — one per stored CallOutcome, in wrap-up
 * order. Labels and tones mirror `outcomeConfig` in src/lib/status.ts (the
 * neutral defaults; workspace vocabulary re-words `bills_fine` at render
 * time, not here — this module stores keys and defaults, never a vertical's
 * copy).
 */
export const SYSTEM_DISPOSITIONS: DispositionDef[] = (
  [
    ["appointment_booked", "Appointment", "success"],
    ["callback_scheduled", "Callback", "warning"],
    ["qualified", "Qualified", "success"],
    ["not_interested", "Not interested", "neutral"],
    ["bills_fine", "No need right now", "warning"],
    ["no_answer", "No answer", "neutral"],
    ["voicemail", "Voicemail", "neutral"],
    ["wrong_number", "Wrong number", "danger"],
    ["do_not_call", "Do not call", "danger"],
  ] as [CallOutcome, string, DispositionTone][]
).map(([key, label, tone], index) => ({
  key,
  label,
  tone,
  behavior: OUTCOME_TO_BEHAVIOR[key]!,
  enabled: true,
  system: true,
  sortOrder: index,
}));

/**
 * Labels that legacy rows were saved under and should ADOPT the system key
 * rather than fork a custom row. Includes the labels the old editor seeded
 * ("Appointment booked", "Callback scheduled"), the wrap-up button copy, the
 * verticals' `noNeedLabel` wordings that admins re-typed by hand, and common
 * shorthand. Compared post-normalization (lowercased, punctuation stripped),
 * so "Booked!" still lands on appointment_booked.
 */
const SYSTEM_LABEL_ALIASES: Record<CallOutcome, string[]> = {
  appointment_booked: ["appointment booked", "booked", "appointment set", "meeting booked"],
  callback_scheduled: ["callback scheduled", "call back", "callback set"],
  qualified: ["qualified lead"],
  not_interested: ["declined", "not interested right now"],
  bills_fine: [
    "bills fine",
    "bills are fine",
    "no need",
    "happy with current cover",
    "not moving right now",
    "no work needed",
    "nothing needed",
    "happy with current setup",
    "happy with current vehicle",
    "not looking right now",
    "not enrolling right now",
  ],
  no_answer: ["no pickup", "rang out"],
  voicemail: ["left voicemail", "voicemail left", "vm"],
  wrong_number: ["bad number", "invalid number", "disconnected"],
  do_not_call: ["dnc", "do not contact"],
};

/** Lowercase, de-accent, and strip punctuation so label matching survives typing. */
function normalizeLabel(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** normalized label / alias → the system row it means. Built once. */
const LABEL_TO_SYSTEM = new Map<string, DispositionDef>();
for (const def of SYSTEM_DISPOSITIONS) {
  LABEL_TO_SYSTEM.set(normalizeLabel(def.label), def);
  for (const alias of SYSTEM_LABEL_ALIASES[def.key as CallOutcome]) {
    LABEL_TO_SYSTEM.set(normalizeLabel(alias), def);
  }
}

const TONES: readonly DispositionTone[] = ["success", "warning", "danger", "neutral"];

function asTone(value: unknown, fallback: DispositionTone): DispositionTone {
  return TONES.includes(value as DispositionTone) ? (value as DispositionTone) : fallback;
}

/**
 * Key for an admin-created disposition: `x_` + slug. The prefix guarantees a
 * custom row can never shadow a canonical CallOutcome — today's nine or any
 * key a future migration adds. Collision between two custom labels that slug
 * identically is the CALLER's problem (suffix a counter before saving); this
 * stays a pure function of the label.
 */
export function customDispositionKey(label: string): string {
  const slug = normalizeLabel(label).replace(/ /g, "_").replace(/^_+|_+$/g, "");
  return `x_${slug || "custom"}`;
}

/**
 * Lift the legacy `{ label, tone }[]` rows into keyed, behavior-carrying defs.
 *
 * Rows whose label matches a system disposition (case-insensitively, aliases
 * included) ADOPT the system key — the admin's wording and tone survive, but
 * the row now drives the real outcome it always visually promised. Labels we
 * can't place become DISABLED custom rows: preserved where the admin can see
 * and re-enable them, never silently dropped — an admin's four hand-typed
 * rows disappearing on upgrade would read as data loss.
 */
export function migrateLegacyDispositions(legacy: unknown): DispositionDef[] {
  if (!Array.isArray(legacy) || legacy.length === 0) {
    return SYSTEM_DISPOSITIONS.map((def) => ({ ...def }));
  }
  const out: DispositionDef[] = [];
  const claimed = new Set<string>();
  for (const row of legacy) {
    if (!row || typeof row !== "object") continue;
    const label = (row as { label?: unknown }).label;
    if (typeof label !== "string" || !label.trim()) continue;
    const tone = (row as { tone?: unknown }).tone;
    const system = LABEL_TO_SYSTEM.get(normalizeLabel(label));
    if (system && !claimed.has(system.key)) {
      claimed.add(system.key);
      out.push({
        ...system,
        label: label.trim(),
        tone: asTone(tone, system.tone),
        sortOrder: out.length,
      });
      continue;
    }
    const key = customDispositionKey(label);
    if (claimed.has(key)) continue;
    claimed.add(key);
    out.push({
      key,
      label: label.trim(),
      tone: asTone(tone, "neutral"),
      behavior: "neutral_end",
      enabled: false,
      system: false,
      sortOrder: out.length,
    });
  }
  return out.length ? out : SYSTEM_DISPOSITIONS.map((def) => ({ ...def }));
}

/**
 * The org's effective disposition set — what the editor edits and the wrap-up
 * panel renders. Three invariants, enforced here rather than trusted to
 * whatever JSON is in the settings blob:
 *
 *  • Every canonical outcome is present. Historical call records carry all
 *    nine keys, so filters and the archive must always be able to name them —
 *    system rows an admin never saved are appended (enabled) in wrap-up order.
 *  • `do_not_call` is always enabled. Suppression is a compliance obligation,
 *    not a preference — no settings shape may hide the DNC button.
 *  • sortOrder is reassigned 0..n-1 so a hand-edited or partially-saved blob
 *    can't produce duplicate or gapped ordering.
 */
export function resolveDispositionDefs(settingsDispositions: unknown): DispositionDef[] {
  const defs = migrateLegacyDispositions(settingsDispositions);
  const present = new Set(defs.map((def) => def.key));
  for (const system of SYSTEM_DISPOSITIONS) {
    if (!present.has(system.key)) defs.push({ ...system });
  }
  return defs.map((def, index) => ({
    ...def,
    enabled: def.key === "do_not_call" ? true : def.enabled,
    sortOrder: index,
  }));
}
