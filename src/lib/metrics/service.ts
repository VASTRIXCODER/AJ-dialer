import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Thin, typed wrappers over the PART-27 metrics RPCs (supabase/schema.sql) —
// the ONE SQL source for the numbers every surface shows. The RPCs are
// service-role only and trust the scope they're handed, so callers must pass a
// scope that was already resolved by application auth (getScope / getViewer),
// exactly like app_leads_page. Definitions live in ./definitions.ts and
// docs/phase-1/metric-glossary.md; the SQL FILTER clauses and ./compute.ts must
// stay in agreement.
//
// Degradation contract: no service role key, RPC error, or a thrown fetch all
// return the zeroed/empty shape — a metrics tile must never crash a page.
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricsScope {
  /** The viewer's org (null only for legacy org-less accounts). */
  orgId: string | null;
  userId: string;
  /** True ⇒ org-wide rows; false ⇒ the viewer's own rows only. */
  supervisor: boolean;
}

/** Shape of app_metrics_summary's jsonb — glossary: connect_rate & friends. */
export interface MetricsSummary {
  /** Raw attempts in the window (system failures included — ops sees volume). */
  calls: number;
  /** Attempts minus system failures — the connect-rate denominator. */
  eligibleAttempts: number;
  /** Canonical connects: coalesce(human_connected, legacy outcome inference). */
  humanConnects: number;
  voicemails: number;
  /** humanConnects ÷ eligibleAttempts, one decimal (0–100). */
  connectRate: number;
  /** talk_sec (fallback duration_sec) averaged over connected calls only. */
  avgTalkSec: number;
  /** Count per terminal outcome; rows without one land in noOutcome instead. */
  outcomes: Record<string, number>;
  noOutcome: number;
  /** Distinct non-cancelled appointments CREATED in the window. */
  appointmentsSet: number;
}

export interface MetricsSummaryOpts {
  /** Half-open window [from, to) — the glossary's timestamp convention. */
  from: Date;
  to: Date;
  campaignId?: string | null;
  repId?: string | null;
  /** "human" | "ai" (call_records.channel; null/absent ⇒ both). */
  channel?: string | null;
}

export interface HourlyBucket {
  /** Org-local call-start hour, 0–23. Unpopulated hours are absent, not zero. */
  hour: number;
  calls: number;
  connects: number;
}

export interface HourlyProductivityOpts {
  /** The org-local day to bucket, as YYYY-MM-DD. */
  day: string;
  /** IANA timezone the day/hours are evaluated in (use orgTimezone(org)). */
  tz: string;
  campaignId?: string | null;
}

const ZERO_SUMMARY: MetricsSummary = {
  calls: 0,
  eligibleAttempts: 0,
  humanConnects: 0,
  voicemails: 0,
  connectRate: 0,
  avgTalkSec: 0,
  outcomes: {},
  noOutcome: 0,
  appointmentsSet: 0,
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Coerce the RPC's jsonb into the typed shape (never trust wire numbers). */
function toSummary(raw: unknown): MetricsSummary {
  if (!raw || typeof raw !== "object") return { ...ZERO_SUMMARY };
  const j = raw as Record<string, unknown>;
  const outcomes: Record<string, number> = {};
  if (j.outcomes && typeof j.outcomes === "object") {
    for (const [k, v] of Object.entries(j.outcomes as Record<string, unknown>)) {
      outcomes[k] = num(v);
    }
  }
  return {
    calls: num(j.calls),
    eligibleAttempts: num(j.eligibleAttempts),
    humanConnects: num(j.humanConnects),
    voicemails: num(j.voicemails),
    connectRate: num(j.connectRate),
    avgTalkSec: num(j.avgTalkSec),
    outcomes,
    noOutcome: num(j.noOutcome),
    appointmentsSet: num(j.appointmentsSet),
  };
}

/**
 * Window summary (calls, connects, rate, talk time, outcome mix, appointments
 * set) via app_metrics_summary. Zeroed shape when the service role is absent
 * or the RPC fails — consumers render an honest empty state, never crash.
 */
export async function getMetricsSummary(
  scope: MetricsScope,
  opts: MetricsSummaryOpts,
): Promise<MetricsSummary> {
  if (!isAdminConfigured()) return { ...ZERO_SUMMARY };
  try {
    const { data, error } = await createAdminClient().rpc("app_metrics_summary", {
      p_org: scope.orgId,
      p_user: scope.userId,
      p_supervisor: scope.supervisor,
      p_from: opts.from.toISOString(),
      p_to: opts.to.toISOString(),
      p_campaign: opts.campaignId ?? null,
      p_rep: opts.repId ?? null,
      p_channel: opts.channel ?? null,
    });
    if (error) {
      console.error("[metrics/service] app_metrics_summary failed:", error.message);
      return { ...ZERO_SUMMARY };
    }
    return toSummary(data);
  } catch (e) {
    console.error(
      "[metrics/service] getMetricsSummary threw:",
      e instanceof Error ? e.message : e,
    );
    return { ...ZERO_SUMMARY };
  }
}

/**
 * Attempts/connects per org-local call-start hour for ONE local day via
 * app_metrics_hourly (DST-safe by construction — see the glossary:
 * hourly_productivity). Empty array on any failure.
 */
export async function getHourlyProductivity(
  scope: MetricsScope,
  opts: HourlyProductivityOpts,
): Promise<HourlyBucket[]> {
  if (!isAdminConfigured()) return [];
  try {
    const { data, error } = await createAdminClient().rpc("app_metrics_hourly", {
      p_org: scope.orgId,
      p_user: scope.userId,
      p_supervisor: scope.supervisor,
      p_day: opts.day,
      p_tz: opts.tz,
      p_campaign: opts.campaignId ?? null,
    });
    if (error) {
      console.error("[metrics/service] app_metrics_hourly failed:", error.message);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).map((b) => ({
      hour: num(b?.hour),
      calls: num(b?.calls),
      connects: num(b?.connects),
    }));
  } catch (e) {
    console.error(
      "[metrics/service] getHourlyProductivity threw:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}
