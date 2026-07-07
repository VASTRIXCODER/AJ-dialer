import type { Lead } from "../types";
import { isValidPhone } from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// Smart lists — auto-updating lead segments defined as pure rules over a Lead.
//
// Deliberately a PURE module (no DB / no server-only) so segments are evaluated
// at read time over the already-fetched, already-scoped Lead[] — the exact
// "fetch scoped rows, then filter in JS" idiom the leads table, campaign stats,
// and reports already use. That means: always fresh, no sync job, no schema
// change, and a rep's lists only ever see the rep's own leads (a supervisor's
// see the org's) because they run over whatever getLeads() already returned.
//
// Every rule here reads only fields present on the Lead row, so no cross-table
// aggregation is needed. (An "AI-qualified" list would need the pre-call
// briefing score persisted first — see getLeadBriefing in ai/services.ts — so
// it's intentionally not here yet.)
// ─────────────────────────────────────────────────────────────────────────────

export type SmartListTone = "success" | "warning" | "danger" | "accent" | "primary" | "neutral";

export interface SmartList {
  id: string;
  label: string;
  description: string;
  tone: SmartListTone;
  match: (lead: Lead, now?: number) => boolean;
}

const DAY = 86_400_000;
// Statuses still in play for outreach (mirror of db/leads DIALABLE).
const DIALABLE = new Set(["new", "no_answer", "callback"]);

export const SMART_LISTS: SmartList[] = [
  {
    id: "high_bill",
    label: "High bill",
    description: "Utility bill $200+/mo — the strongest solar-savings pitch.",
    tone: "success",
    match: (l) => (l.utilityBill ?? 0) >= 200,
  },
  {
    id: "big_load",
    label: "Big home load",
    description: "EV, pool, battery, or multiple systems — high energy use.",
    tone: "accent",
    match: (l) => Boolean(l.hasEV || l.hasPool || l.hasBattery || l.multipleSystems),
  },
  {
    id: "fresh",
    label: "Never called",
    description: "New leads that haven't been contacted yet.",
    tone: "primary",
    match: (l) => l.status === "new" && !l.lastContactedAt,
  },
  {
    id: "going_cold",
    label: "Going cold",
    description: "Still dialable but no contact in 14+ days — re-engage before they go stale.",
    tone: "warning",
    match: (l, now = Date.now()) =>
      DIALABLE.has(l.status) &&
      Boolean(l.lastContactedAt) &&
      now - new Date(l.lastContactedAt as string).getTime() >= 14 * DAY,
  },
  {
    id: "no_phone",
    label: "No valid phone",
    description: "Can't be dialed — needs a corrected number.",
    tone: "danger",
    match: (l) => !isValidPhone(l.phone),
  },
  {
    id: "missing_address",
    label: "Missing address",
    description: "No street or city on file — fill the gap before the call.",
    tone: "warning",
    match: (l) => !l.address?.trim() && !l.city?.trim(),
  },
];

export function smartListById(id: string): SmartList | undefined {
  return SMART_LISTS.find((s) => s.id === id);
}

/** Count how many of `leads` fall into each smart list (for the filter chips). */
export function countSmartLists(leads: Lead[], now = Date.now()): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sl of SMART_LISTS) counts[sl.id] = 0;
  for (const l of leads) {
    for (const sl of SMART_LISTS) if (sl.match(l, now)) counts[sl.id]++;
  }
  return counts;
}
