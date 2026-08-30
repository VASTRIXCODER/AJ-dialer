import "server-only";

import { leads as demoLeads } from "../data";
import { isDialableStatus } from "../leads/dialable";
import {
  evaluateFilter,
  type FilterContext,
  type FilterSpec,
  type LeadForFilter,
} from "../leads/filter-spec";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import type { Lead } from "../types";
import { getLeads, rowToLead } from "./leads";
import type { Scope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// Typed-filter reads — the server half of the FilterSpec system (PART 29).
//
// The REAL path calls the service-role RPCs (app_filter_leads / app_lead_counts,
// supabase/schema.sql PART 29): the SQL compiler is the semantic twin of
// evaluateFilter, and the caller-supplied Scope is what the SQL trusts — so
// every entry point here takes the ALREADY-AUTHORIZED scope from getScope(),
// never raw ids off a request body.
//
// The DEMO/degraded path runs the SAME sanitized spec through evaluateFilter
// over in-memory leads: the bundled sample book when Supabase is absent, the
// RLS-scoped getLeads() read when only the service key is missing. One grammar,
// three modes, no crashes — the documented posture.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

export interface FilterSort {
  key: string;
  dir: "asc" | "desc";
}

export interface FilteredLeadsOptions {
  filter: FilterSpec;
  sort?: FilterSort[];
  offset?: number;
  limit?: number;
}

/** The 8 drillable tiles — definitions in docs/phase-1/metric-glossary.md
 *  ("Lead counts") and, verbatim for humans, LEAD_COUNT_DEFINITIONS in
 *  src/components/leads/lead-counts-row.tsx (the test pins the two together). */
export interface LeadCounts {
  active: number;
  dialEligible: number;
  assigned: number;
  unassigned: number;
  neverDialed: number;
  attempted: number;
  dnc: number;
  archived: number;
}

const EMPTY_COUNTS: LeadCounts = {
  active: 0,
  dialEligible: 0,
  assigned: 0,
  unassigned: 0,
  neverDialed: 0,
  attempted: 0,
  dnc: 0,
  archived: 0,
};

/**
 * Build the flat evaluator shape from an app Lead — the demo/degraded twin of
 * the SQL's column reads. Lead deliberately doesn't carry the attempt columns
 * (they live DB-side), so this uses the SAME approximation as neverDialedCount
 * in db/leads.ts: a contacted lead counts as attempted once. Exported for tests.
 */
export function leadToFilterShape(lead: Lead): LeadForFilter {
  return {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: lead.phone,
    address: lead.address ?? null,
    city: lead.city,
    state: lead.state,
    county: lead.county ?? null,
    zip: lead.zip,
    timezone: lead.timezone ?? "",
    status: lead.status,
    campaignId: lead.campaignId,
    leadGroup: lead.leadGroup ?? null,
    leadPackId: lead.leadPackId ?? null,
    assignedRepId: lead.assignedRepId ?? null,
    ownerId: lead.ownerId ?? null,
    createdAt: lead.createdAt,
    lastContactedAt: lead.lastContactedAt ?? null,
    utilityBill: lead.utilityBill ?? null,
    solarPayment: lead.solarPayment ?? null,
    hasEV: lead.hasEV,
    hasPool: lead.hasPool,
    hasBattery: lead.hasBattery,
    multipleSystems: lead.multipleSystems,
    customFields: lead.customFields,
    phoneDigits: (lead.phone ?? "").replace(/\D/g, ""),
    // Attempt columns approximated from lastContactedAt — every completed call
    // stamps both, so never_dialed stays consistent with the SQL definition.
    attemptCount: lead.lastContactedAt ? 1 : 0,
    lastAttemptAt: lead.lastContactedAt ?? null,
    latestOutcome: null,
    // Status stands in for the callbacks/appointments join the demo book lacks.
    hasOpenCallback: lead.status === "callback",
    hasScheduledAppointment: lead.status === "appointment",
    archivedAt: null,
    importJobId: null,
    sourceFile: null,
    // SQL reads coalesce(dialing_preference, 'either') — mirror the default.
    dialingPreference: "either",
    nextEligibleAt: null,
  };
}

/** The leads the demo/degraded paths run a filter over. */
async function fallbackBook(): Promise<Lead[]> {
  // No Supabase at all → the bundled sample book (empty unless demo data is
  // opted into). Configured-but-keyless self-host → the RLS-scoped read:
  // correct, just not cheap — same degraded posture as getLeadsPage.
  if (!isSupabaseConfigured()) return demoLeads;
  try {
    return await getLeads();
  } catch {
    return [];
  }
}

/**
 * JS mirror of app_filter_leads' sort whitelist (the CASE arms in schema.sql).
 * Unknown keys are skipped, nulls sort last regardless of direction, and the
 * upload-order tiebreak (created_at, id) always closes — same contract.
 */
const DEMO_SORT_VALUES: Record<string, (l: Lead) => string | number | null> = {
  name: (l) => `${l.lastName ?? ""} ${l.firstName ?? ""}`.toLowerCase(),
  city: (l) => (l.city ?? "").toLowerCase(),
  state: (l) => (l.state ?? "").toLowerCase(),
  status: (l) => l.status,
  utility_bill: (l) => l.utilityBill ?? null,
  solar_payment: (l) => l.solarPayment ?? null,
  ai_score: (l) => l.aiScore ?? null,
  last_contacted_at: (l) =>
    l.lastContactedAt ? Date.parse(l.lastContactedAt) || null : null,
  created_at: (l) => (l.createdAt ? Date.parse(l.createdAt) || null : null),
  attempt_count: (l) => (l.lastContactedAt ? 1 : 0),
  last_attempt_at: (l) =>
    l.lastContactedAt ? Date.parse(l.lastContactedAt) || null : null,
  next_eligible_at: () => null,
};

function sortDemo(leads: Lead[], sorts: FilterSort[] | undefined): Lead[] {
  const lanes = (sorts ?? [])
    .slice(0, 3)
    .filter((s) => DEMO_SORT_VALUES[s.key])
    .map((s) => ({ value: DEMO_SORT_VALUES[s.key], desc: s.dir === "desc" }));
  return [...leads].sort((a, b) => {
    for (const lane of lanes) {
      const va = lane.value(a);
      const vb = lane.value(b);
      if (va === null && vb === null) continue;
      if (va === null) return 1; // nulls last, either direction
      if (vb === null) return -1;
      const cmp =
        typeof va === "string" && typeof vb === "string"
          ? va.localeCompare(vb)
          : va < vb
            ? -1
            : va > vb
              ? 1
              : 0;
      if (cmp !== 0) return lane.desc ? -cmp : cmp;
    }
    // Upload-order tiebreak: (created_at, id) — total and stable.
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

function demoMatches(all: Lead[], filter: FilterSpec): Lead[] {
  const ctx: FilterContext = { now: new Date() };
  return all.filter((l) => evaluateFilter(leadToFilterShape(l), filter, ctx));
}

/**
 * One page of leads matching a SANITIZED FilterSpec, plus the accurate total.
 * `scope` must come from getScope() — the RPC trusts it. Errors degrade to an
 * empty page rather than throwing into a render.
 */
export async function getFilteredLeadsPage(
  scope: Scope,
  opts: FilteredLeadsOptions,
): Promise<{ leads: Lead[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 1000);
  const offset = Math.max(opts.offset ?? 0, 0);

  if (!isAdminConfigured()) {
    const matched = demoMatches(await fallbackBook(), opts.filter);
    return {
      leads: sortDemo(matched, opts.sort).slice(offset, offset + limit),
      total: matched.length,
    };
  }

  try {
    const { data, error } = await createAdminClient().rpc("app_filter_leads", {
      p_org: scope.orgId,
      p_user: scope.userId,
      p_supervisor: scope.supervisor,
      p_filter: opts.filter,
      p_sort: opts.sort ?? null,
      p_offset: offset,
      p_limit: limit,
      p_count_only: false,
    });
    if (error || !data) return { leads: [], total: 0 };
    const payload = data as { rows?: Row[]; total?: number };
    return {
      leads: (payload.rows ?? []).map(rowToLead),
      total: Number(payload.total ?? 0),
    };
  } catch {
    return { leads: [], total: 0 };
  }
}

/**
 * JUST the ids matching a SANITIZED spec, capped — the allocation path's
 * candidate resolver (Assignment Center: filter / smart-list sources resolve to
 * ids here, then travel to app_allocate_assignment as p_lead_ids, keeping ONE
 * filter compiler). Same RPC as the page read; only the projection differs.
 */
export async function getFilteredLeadIds(
  scope: Scope,
  filter: FilterSpec,
  cap = 10_000,
): Promise<string[]> {
  const limit = Math.min(Math.max(cap, 1), 10_000);
  if (!isAdminConfigured()) {
    return demoMatches(await fallbackBook(), filter)
      .slice(0, limit)
      .map((l) => l.id);
  }
  try {
    const { data, error } = await createAdminClient().rpc("app_filter_leads", {
      p_org: scope.orgId,
      p_user: scope.userId,
      p_supervisor: scope.supervisor,
      p_filter: filter,
      p_sort: null,
      p_offset: 0,
      p_limit: limit,
      p_count_only: false,
    });
    if (error || !data) return [];
    const payload = data as { rows?: Row[] };
    return (payload.rows ?? []).map((r) => String(r.id)).filter(Boolean);
  } catch {
    return [];
  }
}

/** Accurate "N match" for a SANITIZED spec — the LiveCount backend. */
export async function countFilteredLeads(
  scope: Scope,
  filter: FilterSpec,
): Promise<number> {
  if (!isAdminConfigured()) return demoMatches(await fallbackBook(), filter).length;
  try {
    const { data, error } = await createAdminClient().rpc("app_filter_leads", {
      p_org: scope.orgId,
      p_user: scope.userId,
      p_supervisor: scope.supervisor,
      p_filter: filter,
      p_sort: null,
      p_offset: 0,
      p_limit: 1,
      p_count_only: true,
    });
    if (error || !data) return 0;
    return Number((data as { total?: number }).total ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Demo/degraded twin of app_lead_counts. The derived predicates go through
 * evaluateFilter (single-condition specs) so the tiles can never disagree with
 * what the same filter would select — the whole point of accurate counts.
 */
function demoLeadCounts(all: Lead[]): LeadCounts {
  const ctx: FilterContext = { now: new Date() };
  const derived = (l: LeadForFilter, key: "dial_eligible" | "dnc" | "never_dialed") =>
    evaluateFilter(
      l,
      { op: "and", groups: [{ op: "and", conditions: [{ kind: "derived", key, cmp: "is_true" }] }] },
      ctx,
    );
  const counts = { ...EMPTY_COUNTS };
  for (const lead of all) {
    const l = leadToFilterShape(lead);
    const archived = l.archivedAt != null;
    const onDnc = derived(l, "dnc");
    if (l.status === "dnc" || onDnc) counts.dnc += 1;
    if (archived || l.phoneDigits.length < 10) counts.archived += 1;
    if (!archived && l.status !== "dnc") {
      counts.active += 1;
      if (l.assignedRepId) counts.assigned += 1;
      else counts.unassigned += 1;
    }
    if (!archived && derived(l, "dial_eligible")) counts.dialEligible += 1;
    if (!archived && derived(l, "never_dialed") && isDialableStatus(l.status)) {
      counts.neverDialed += 1;
    }
    if (!archived && (l.attemptCount > 0 || l.lastAttemptAt)) counts.attempted += 1;
  }
  return counts;
}

/** The 8 tile counts for the viewer's scope — one RPC scan (app_lead_counts). */
export async function getLeadCounts(scope: Scope): Promise<LeadCounts> {
  if (!isAdminConfigured()) return demoLeadCounts(await fallbackBook());
  try {
    const { data, error } = await createAdminClient().rpc("app_lead_counts", {
      p_org: scope.orgId,
      p_user: scope.userId,
      p_supervisor: scope.supervisor,
    });
    if (error || !data) return { ...EMPTY_COUNTS };
    const r = data as Partial<Record<keyof LeadCounts, unknown>>;
    return {
      active: Number(r.active ?? 0),
      dialEligible: Number(r.dialEligible ?? 0),
      assigned: Number(r.assigned ?? 0),
      unassigned: Number(r.unassigned ?? 0),
      neverDialed: Number(r.neverDialed ?? 0),
      attempted: Number(r.attempted ?? 0),
      dnc: Number(r.dnc ?? 0),
      archived: Number(r.archived ?? 0),
    };
  } catch {
    return { ...EMPTY_COUNTS };
  }
}
