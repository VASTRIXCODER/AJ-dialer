import { DIALABLE_STATUSES } from "./leads/dialable";
import { isConnectedRecord } from "./metrics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// Pure per-campaign aggregation — lead pipeline + call performance keyed by
// campaign_id. No DB imports so it can be unit-tested; db/pipeline.ts feeds it
// the fetched rows (org-scoped for supervisors, own-scoped for reps).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/**
 * How many real rows one input row stands for.
 *
 * These functions used to be fed the lead and call rows themselves, which meant
 * fetching them — and the fetch was capped (20,000 call records against a
 * PostgREST page ceiling, ordered by a `gen_random_uuid()` primary key, so the
 * sample was not merely partial but arbitrary). Measured: 34,079 call records,
 * of which about 59% arrived, rendered as six confident totals and a funnel.
 *
 * The counting now happens in SQL — app_campaign_stats — and each row that
 * arrives carries `n`. Absent means one, so every existing caller and test is
 * unchanged, and the CLASSIFICATION rules below stay the only copy.
 */
const weight = (r: Row): number => {
  const n = Number(r.n ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const sum = (rows: Row[]): number => rows.reduce((t, r) => t + weight(r), 0);

const DIALABLE: ReadonlySet<string> = new Set(DIALABLE_STATUSES);

/** One connect definition, shared with every other surface in the product. */
const isConnected = (c: Row): boolean =>
  isConnectedRecord({
    outcome: (c.outcome ?? null) as string | null,
    humanConnected: (c.human_connected ?? null) as boolean | null,
  });
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
 * Compute stats for one campaign from lead + call rows.
 *
 * `leads` rows need { campaign_id, status }; `calls` rows need
 * { campaign_id, outcome }. Either may carry `n` — see `weight`.
 */
export function statsForCampaign(
  campaignId: string,
  leads: Row[],
  calls: Row[],
): CampaignStats {
  const myLeads = leads.filter((l) => String(l.campaign_id ?? "") === campaignId);
  const myCalls = calls.filter((c) => String(c.campaign_id ?? "") === campaignId);
  const totalLeads = sum(myLeads);
  const dialableLeads = sum(myLeads.filter((l) => DIALABLE.has(String(l.status))));
  // `last_contacted_at`, not `status !== "new"`. The status test counted a
  // lead imported straight onto the do-not-call list as somebody the floor had
  // spoken to, and missed a contacted lead that was reset to "new" for a retry.
  // It is the same signal classifyLeadBucket uses to tell untouched from
  // in-progress, so the two screens now agree.
  const contactedLeads = sum(myLeads.filter((l) => Boolean(l.contacted)));
  const calls_ = sum(myCalls);
  // Through isConnectedRecord — the one definition of "connected" in the
  // product. This was the only connect rate that did not go through it, and it
  // ignored `human_connected` entirely.
  const connects = sum(myCalls.filter(isConnected));
  const appointments = sum(myCalls.filter((c) => c.outcome === "appointment_booked"));
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
  const calls = sum(rows);
  const connects = sum(rows.filter(isConnected));
  const appointments = sum(rows.filter((c) => c.outcome === "appointment_booked"));
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
