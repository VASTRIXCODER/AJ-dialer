import type { CallOutcome } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Pure call-analytics helpers shared by the reports + dashboard data layer.
// No DB/server imports so they can be unit-tested directly; db/metrics.ts feeds
// them the fetched rows (own-scoped for reps, org-scoped for supervisors).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Outcomes that mean a real conversation happened. */
export const CONNECTED_OUTCOMES = new Set<CallOutcome>([
  "appointment_booked",
  "callback_scheduled",
  "qualified",
  "not_interested",
  "do_not_call",
]);

/** Every disposition, in funnel-ish order, with a label + chart color. */
export const OUTCOME_META: Record<CallOutcome, { label: string; color: string }> = {
  appointment_booked: { label: "Appointment booked", color: "var(--color-chart-3)" },
  callback_scheduled: { label: "Callback scheduled", color: "var(--color-chart-1)" },
  qualified: { label: "Qualified", color: "var(--color-chart-2)" },
  not_interested: { label: "Not interested", color: "var(--color-chart-5)" },
  bills_fine: { label: "Bills are fine", color: "var(--color-warning)" },
  voicemail: { label: "Voicemail", color: "var(--color-chart-4)" },
  no_answer: { label: "No answer", color: "var(--color-muted-foreground)" },
  wrong_number: { label: "Wrong number", color: "var(--color-chart-5)" },
  do_not_call: { label: "Do not call", color: "var(--color-danger)" },
};

export const ALL_OUTCOMES = Object.keys(OUTCOME_META) as CallOutcome[];
const ORDER = new Map(ALL_OUTCOMES.map((o, i) => [o, i]));

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const avg = (a: number[]) =>
  a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;

const outcomeOf = (r: Row): CallOutcome | null => (r.outcome as CallOutcome) ?? null;
export const isConnectedRow = (r: Row): boolean => {
  const o = outcomeOf(r);
  return o != null && CONNECTED_OUTCOMES.has(o);
};

export interface DispositionRow {
  key: CallOutcome;
  label: string;
  color: string;
  count: number;
  /** % of all calls */
  rate: number;
  connected: boolean;
}

/** Counts + rates for EVERY disposition (zeros included), busiest first. */
export function dispositionBreakdown(calls: Row[]): DispositionRow[] {
  const total = calls.length;
  const counts = {} as Record<CallOutcome, number>;
  for (const c of calls) {
    const o = outcomeOf(c);
    if (o) counts[o] = (counts[o] ?? 0) + 1;
  }
  return ALL_OUTCOMES.map((key) => ({
    key,
    label: OUTCOME_META[key].label,
    color: OUTCOME_META[key].color,
    count: counts[key] ?? 0,
    rate: pct(counts[key] ?? 0, total),
    connected: CONNECTED_OUTCOMES.has(key),
  })).sort((a, b) => b.count - a.count || ORDER.get(a.key)! - ORDER.get(b.key)!);
}

export interface ChannelRow {
  channel: "ai" | "human";
  label: string;
  calls: number;
  connects: number;
  connectRate: number;
  appointments: number;
  apptRate: number;
  avgTalkSec: number;
}

function channelStat(channel: "ai" | "human", list: Row[]): ChannelRow {
  const connects = list.filter(isConnectedRow).length;
  const appts = list.filter((c) => outcomeOf(c) === "appointment_booked").length;
  const durs = list.map((c) => Number(c.duration_sec ?? 0)).filter((n) => n > 0);
  return {
    channel,
    label: channel === "ai" ? "AI agent" : "Human reps",
    calls: list.length,
    connects,
    connectRate: pct(connects, list.length),
    appointments: appts,
    apptRate: pct(appts, list.length),
    avgTalkSec: avg(durs),
  };
}

/** AI vs human comparison (both rows always present). */
export function channelBreakdown(calls: Row[]): ChannelRow[] {
  // Only calls the AI agent explicitly logged (channel === "ai") count as AI.
  // Everything else — "human" AND any null/legacy channel — is a human call. The
  // old `channel !== "human"` test folded null-channel human/legacy rows into the
  // AI bucket, inflating the AI agent's call/connect/appointment counts on the
  // AI-vs-human panel. (call_records.channel defaults to "human"; the AI path
  // always sets "ai" explicitly.)
  const ai = calls.filter((c) => c.channel === "ai");
  const human = calls.filter((c) => c.channel !== "ai");
  return [channelStat("ai", ai), channelStat("human", human)];
}

export interface Funnel {
  dials: number;
  connects: number;
  appointments: number;
  /** connects / dials */
  connectRate: number;
  /** appointments / connects */
  apptRate: number;
}

/** Dials → connects → appointments funnel with stage rates. */
export function funnelOf(calls: Row[]): Funnel {
  const dials = calls.length;
  const connects = calls.filter(isConnectedRow).length;
  const appointments = calls.filter((c) => outcomeOf(c) === "appointment_booked").length;
  return {
    dials,
    connects,
    appointments,
    connectRate: pct(connects, dials),
    apptRate: pct(appointments, connects),
  };
}
