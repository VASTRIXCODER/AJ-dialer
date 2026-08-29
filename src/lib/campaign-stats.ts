import { CONNECTED_OUTCOMES } from "./call-analytics";
import { DIALABLE_STATUSES } from "./leads/dialable";
import type { CallOutcome } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Pure per-campaign aggregation — lead pipeline + call performance keyed by
// campaign_id. No DB imports so it can be unit-tested; db/pipeline.ts feeds it
// the fetched rows (org-scoped for supervisors, own-scoped for reps).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const DIALABLE: ReadonlySet<string> = new Set(DIALABLE_STATUSES);
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export interface CampaignStats {
  totalLeads: number;
  dialableLeads: number;
  contactedLeads: number;
  calls: number;
  connects: number;
  appointments: number;
  /** contacted leads / total leads */
  contactRate: number;
  /** connects / calls */
  connectRate: number;
}

export function emptyStats(): CampaignStats {
  return {
    totalLeads: 0,
    dialableLeads: 0,
    contactedLeads: 0,
    calls: 0,
    connects: 0,
    appointments: 0,
    contactRate: 0,
    connectRate: 0,
  };
}

/**
 * Compute stats for one campaign from already-fetched lead + call rows.
 * `leads` rows need { campaign_id, status }; `calls` rows need
 * { campaign_id, outcome }.
 */
export function statsForCampaign(
  campaignId: string,
  leads: Row[],
  calls: Row[],
): CampaignStats {
  const myLeads = leads.filter((l) => String(l.campaign_id ?? "") === campaignId);
  const myCalls = calls.filter((c) => String(c.campaign_id ?? "") === campaignId);
  const totalLeads = myLeads.length;
  const dialableLeads = myLeads.filter((l) => DIALABLE.has(String(l.status))).length;
  const contactedLeads = myLeads.filter((l) => String(l.status ?? "new") !== "new").length;
  const calls_ = myCalls.length;
  const connects = myCalls.filter((c) => {
    const o = c.outcome as CallOutcome | null;
    return o != null && CONNECTED_OUTCOMES.has(o);
  }).length;
  const appointments = myCalls.filter((c) => c.outcome === "appointment_booked").length;
  return {
    totalLeads,
    dialableLeads,
    contactedLeads,
    calls: calls_,
    connects,
    appointments,
    contactRate: pct(contactedLeads, totalLeads),
    connectRate: pct(connects, calls_),
  };
}

// ── Script A/B test splitter ─────────────────────────────────────────────────

/** One script variant's slice of a campaign's call performance. */
export interface ScriptVariantStats {
  calls: number;
  connects: number;
  /** connects / calls, one decimal. */
  connectRate: number;
  appointments: number;
  /** appointments / connects, one decimal — same math as the funnel's apptRate. */
  apptRate: number;
}

export interface ScriptTestStats {
  a: ScriptVariantStats;
  b: ScriptVariantStats;
}

export function emptyVariantStats(): ScriptVariantStats {
  return { calls: 0, connects: 0, connectRate: 0, appointments: 0, apptRate: 0 };
}

function variantStats(rows: Row[]): ScriptVariantStats {
  const calls = rows.length;
  const connects = rows.filter((c) => {
    const o = c.outcome as CallOutcome | null;
    return o != null && CONNECTED_OUTCOMES.has(o);
  }).length;
  const appointments = rows.filter((c) => c.outcome === "appointment_booked").length;
  return {
    calls,
    connects,
    connectRate: pct(connects, calls),
    appointments,
    apptRate: pct(appointments, connects),
  };
}

/**
 * Per-variant performance for one campaign's script A/B test, from already-
 * fetched call rows ({ campaign_id, outcome, script_variant }). Only rows where
 * a script was actually shown (script_variant "a"/"b") are counted — rows with
 * a null/unknown variant (e.g. auto-filed no-answers from parallel dials, or
 * calls predating the test) carry no script context and sit outside the split.
 */
export function scriptTestForCampaign(campaignId: string, calls: Row[]): ScriptTestStats {
  const mine = calls.filter((c) => String(c.campaign_id ?? "") === campaignId);
  return {
    a: variantStats(mine.filter((c) => c.script_variant === "a")),
    b: variantStats(mine.filter((c) => c.script_variant === "b")),
  };
}
