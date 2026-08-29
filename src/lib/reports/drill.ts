import { CONNECTED_OUTCOMES } from "../call-analytics";
import {
  encodeFilterParam,
  type FilterCondition,
  type FilterSpec,
} from "../leads/filter-spec";

// ─────────────────────────────────────────────────────────────────────────────
// Report drill-downs — the FilterSpec behind every clickable number on /reports.
//
// Reports are computed from CALL rows; the leads table filters LEAD rows, so a
// drill-down is a deliberate LEADS-SIDE APPROXIMATION of the figure it hangs
// off (the DrillLink tooltip says "opens the matching leads" for exactly this
// reason): "total calls" becomes "leads attempted in the range", an outcome
// slice becomes "leads whose LATEST outcome is X", a rep row becomes "leads
// assigned to that rep". Hour-of-day buckets have no lead-side expression at
// all, so the hourly chart deliberately gets NO link — a wrong link is worse
// than none.
//
// Every spec built here must survive sanitizeFilterSpec unchanged
// (tests/report-links.test.ts pins that), so a drilled URL can never silently
// show a different set than the number the user clicked.
//
// PURE + isomorphic — imported by Server report sections and client links alike.
// ─────────────────────────────────────────────────────────────────────────────

const group = (conditions: FilterCondition[]): FilterSpec => ({
  op: "and",
  groups: [{ op: "and", conditions }],
});

/**
 * The range approximation: "last N days" becomes `last_attempt_at within N
 * days`. within_days measures distance from now in either direction, but a
 * last-attempt timestamp is never in the future, so for this field it reads as
 * the honest "attempted in the last N days". null (all time) adds no condition.
 */
function rangeCondition(rangeDays: number | null): FilterCondition[] {
  if (rangeDays == null || rangeDays <= 0) return [];
  return [{ kind: "core", key: "last_attempt_at", cmp: "within_days", value: rangeDays }];
}

/** "Total calls" / funnel "Dials" → leads attempted in the range. */
export function drillDialed(rangeDays: number | null): FilterSpec {
  return group([
    { kind: "core", key: "attempt_count", cmp: "gt", value: 0 },
    ...rangeCondition(rangeDays),
  ]);
}

/** "Connections" / funnel "Connects" → leads whose latest outcome connected. */
export function drillConnected(rangeDays: number | null): FilterSpec {
  return group([
    // Sorted so the same figure always encodes the same URL.
    { kind: "derived", key: "latest_outcome", cmp: "in", value: [...CONNECTED_OUTCOMES].sort() },
    ...rangeCondition(rangeDays),
  ]);
}

/** One disposition slice → leads whose LATEST outcome is that stored key. */
export function drillOutcome(outcomeKey: string, rangeDays: number | null): FilterSpec {
  return group([
    { kind: "derived", key: "latest_outcome", cmp: "eq", value: outcomeKey },
    ...rangeCondition(rangeDays),
  ]);
}

/** "Appointments" → leads with an appointment on the books right now. */
export function drillAppointments(): FilterSpec {
  return group([{ kind: "derived", key: "has_scheduled_appointment", cmp: "is_true" }]);
}

/** A rep row → that rep's assigned leads. */
export function drillRep(repId: string): FilterSpec {
  return group([{ kind: "core", key: "assigned_rep_id", cmp: "eq", value: repId }]);
}

/** Spec → /leads URL. "" when the spec can't encode (caller renders no link). */
export function drillHref(spec: FilterSpec): string {
  const param = encodeFilterParam(spec);
  return param ? `/leads?f=${param}` : "";
}
