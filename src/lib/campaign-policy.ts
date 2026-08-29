import { CONNECTED_OUTCOMES } from "./call-analytics";
import type { FilterCondition, FilterSpec } from "./leads/filter-spec";
import { sanitizeFilterSpec } from "./leads/filter-spec";

// ─────────────────────────────────────────────────────────────────────────────
// Campaign policy — PURE module (no DB, no server-only), the typed twin of the
// campaigns table's jsonb columns (audience / dialing_policy / retry_policy /
// goals) added in schema PART 34.
//
// Everything stored in those columns is UNTRUSTED on read (hand-edited blobs,
// older writers, the API's raw body), so this module follows the filter-spec
// convention: sanitizers that DROP what doesn't fit instead of throwing — a
// half-corrupt policy degrades to the parts that still make sense, never to a
// crashed campaign page. The API route and db/pipeline both run writes through
// these same functions, so storage only ever holds sanitized shapes.
//
// stageFilter() maps each funnel bucket (app_campaign_funnel's mutually-
// exclusive current-state buckets) to the CLOSEST FilterSpec, so every funnel
// segment is drillable into /leads?f=… . Buckets that are call-derived in SQL
// (connected, exhausted, excluded) get the nearest lead-side approximation and
// carry an `approximate` note the UI surfaces as a tooltip — an honest "close,
// not exact" beats an unclickable number.
// ─────────────────────────────────────────────────────────────────────────────

export type CampaignDialingMode = "manual" | "ai";

/** Canonical order — sanitizeDialingModes emits subsets in this order. */
export const CAMPAIGN_DIALING_MODES: readonly CampaignDialingMode[] = ["manual", "ai"];

/** One inclusive-start, exclusive-end hour window (same shape as AutomationWindow). */
export interface CampaignWindow {
  start: number;
  end: number;
}

/** 0 = inherit the org's own limit — a campaign only ever narrows, never widens. */
export interface CampaignPacing {
  callsPerRun: number;
  maxConcurrent: number;
}

export interface CampaignDialingPolicy {
  /** Which dialers may touch this campaign's leads. EMPTY = no restriction. */
  modes: CampaignDialingMode[];
  /** Hour windows (local to `timezone`). EMPTY = follow the org schedule. */
  windows: CampaignWindow[];
  /** IANA timezone the windows are evaluated in. "" = the org's. */
  timezone: string;
  pacing: CampaignPacing;
}

/** 0 on either knob = "no campaign-level gate" (the org's own settings apply). */
export interface CampaignRetryPolicy {
  maxAttempts: number;
  cooldownHours: number;
}

export interface CampaignAudience {
  kind: "all" | "filter" | "smart_list";
  /** Present only when kind = "filter" — ALWAYS sanitize-stable. */
  filter?: FilterSpec;
  /** Present only when kind = "smart_list". */
  smartListId?: string;
}

export interface CampaignGoals {
  appointments?: number;
  connects?: number;
  periodDays?: number;
}

// ── Small shared coercions ───────────────────────────────────────────────────

/** Finite → clamped int; anything else → null (caller decides the default). */
function toInt(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

// ── Sanitizers (the write AND read boundary) ─────────────────────────────────

/** Whatever came in → the valid mode subset, deduped, in canonical order. */
export function sanitizeDialingModes(raw: unknown): CampaignDialingMode[] {
  if (!Array.isArray(raw)) return [];
  const present = new Set(raw.filter((m): m is CampaignDialingMode =>
    CAMPAIGN_DIALING_MODES.includes(m as CampaignDialingMode),
  ));
  return CAMPAIGN_DIALING_MODES.filter((m) => present.has(m));
}

/** Valid hour windows only (0–23 start, 1–24 end, start < end), capped at 8. */
export function sanitizeCampaignWindows(raw: unknown): CampaignWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: CampaignWindow[] = [];
  for (const w of raw.slice(0, 8)) {
    if (!isRecord(w)) continue;
    const start = toInt(w.start, 0, 23);
    const end = toInt(w.end, 1, 24);
    if (start === null || end === null || start >= end) continue;
    out.push({ start, end });
  }
  return out;
}

/**
 * Untrusted jsonb → a complete CampaignDialingPolicy, or null when the value
 * isn't an object at all (column null = "no campaign policy").
 */
export function sanitizeDialingPolicy(raw: unknown): CampaignDialingPolicy | null {
  if (!isRecord(raw)) return null;
  const pacing = isRecord(raw.pacing) ? raw.pacing : {};
  return {
    modes: sanitizeDialingModes(raw.modes),
    windows: sanitizeCampaignWindows(raw.windows),
    timezone: typeof raw.timezone === "string" ? raw.timezone.trim().slice(0, 64) : "",
    pacing: {
      callsPerRun: toInt(pacing.callsPerRun, 0, 100) ?? 0,
      maxConcurrent: toInt(pacing.maxConcurrent, 0, 100) ?? 0,
    },
  };
}

/** Untrusted jsonb → integer retry gates (0 = off), or null for "no policy". */
export function sanitizeRetryPolicy(raw: unknown): CampaignRetryPolicy | null {
  if (!isRecord(raw)) return null;
  return {
    maxAttempts: toInt(raw.maxAttempts, 0, 99) ?? 0,
    cooldownHours: toInt(raw.cooldownHours, 0, 720) ?? 0,
  };
}

/**
 * Keep only the caller IDs that are actually in the org's pool — a campaign
 * must never dial from a number the workspace doesn't own (deleted from the
 * pool, or injected via the API). Order and duplicates follow the pool.
 */
export function filterCallerIds(raw: unknown, pool: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((v): v is string => typeof v === "string"));
  return pool.filter((n) => wanted.has(n)).slice(0, 50);
}

/**
 * Keep only disposition keys the org's resolved disposition set actually has
 * (system CallOutcomes + `x_*` customs). EMPTY = every disposition allowed.
 */
export function filterDispositionKeys(raw: unknown, validKeys: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((v): v is string => typeof v === "string"));
  return validKeys.filter((k) => wanted.has(k)).slice(0, 64);
}

/**
 * Untrusted jsonb → a coherent audience. A "filter" audience whose spec no
 * longer sanitizes to any valid condition, or a "smart_list" without an id,
 * DEGRADES to {kind:"all"} — an audience that silently matched nothing would
 * read as "the campaign is done" when it's actually misconfigured.
 */
export function sanitizeAudience(raw: unknown): CampaignAudience | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (kind === "filter") {
    const filter = sanitizeFilterSpec(raw.filter);
    return filter ? { kind: "filter", filter } : { kind: "all" };
  }
  if (kind === "smart_list") {
    const id = typeof raw.smartListId === "string" ? raw.smartListId.trim().slice(0, 64) : "";
    return id ? { kind: "smart_list", smartListId: id } : { kind: "all" };
  }
  if (kind === "all") return { kind: "all" };
  return null;
}

/** Untrusted jsonb → non-negative integer goals; null when nothing survives. */
export function sanitizeGoals(raw: unknown): CampaignGoals | null {
  if (!isRecord(raw)) return null;
  const out: CampaignGoals = {};
  const appointments = toInt(raw.appointments, 0, 1_000_000);
  const connects = toInt(raw.connects, 0, 1_000_000);
  const periodDays = toInt(raw.periodDays, 1, 365);
  if (appointments !== null && appointments > 0) out.appointments = appointments;
  if (connects !== null && connects > 0) out.connects = connects;
  if (periodDays !== null) out.periodDays = periodDays;
  return Object.keys(out).length ? out : null;
}

// ── The funnel (app_campaign_funnel's buckets, typed) ────────────────────────

export const FUNNEL_STAGES = [
  "eligible",
  "assigned",
  "attempted",
  "connected",
  "callback",
  "appointment",
  "converted",
  "exhausted",
  "dnc",
  "excluded",
] as const;

export type CampaignFunnelStage = (typeof FUNNEL_STAGES)[number];

export type CampaignFunnel = Record<CampaignFunnelStage, number> & { total: number };

export function emptyFunnel(): CampaignFunnel {
  return {
    eligible: 0,
    assigned: 0,
    attempted: 0,
    connected: 0,
    callback: 0,
    appointment: 0,
    converted: 0,
    exhausted: 0,
    dnc: 0,
    excluded: 0,
    total: 0,
  };
}

/** RPC jsonb → typed funnel; anything missing or non-numeric reads as 0. */
export function parseFunnel(raw: unknown): CampaignFunnel {
  const out = emptyFunnel();
  if (!isRecord(raw)) return out;
  for (const key of [...FUNNEL_STAGES, "total"] as const) {
    const n = Number(raw[key]);
    if (Number.isFinite(n) && n >= 0) out[key] = Math.round(n);
  }
  return out;
}

/**
 * Presentation metadata per stage. `approximate` is set when the SQL bucket is
 * call-derived (or composed of several exclusions) and the drill filter can
 * only get CLOSE — the UI shows it as a tooltip so the number and the drilled
 * row set disagreeing reads as documented behavior, not a bug.
 */
export const FUNNEL_STAGE_META: Record<
  CampaignFunnelStage,
  { label: string; description: string; approximate?: string }
> = {
  eligible: {
    label: "Eligible",
    description: "Never dialed, unassigned, and dialable right now.",
    approximate:
      "The funnel bucket also excludes leads counted in later stages; the drill shows every currently-eligible lead.",
  },
  assigned: {
    label: "Assigned",
    description: "Handed to a rep, not yet worked.",
    approximate:
      "The funnel bucket is assigned-and-not-yet-attempted; the drill shows every assigned lead.",
  },
  attempted: { label: "Attempted", description: "Dialed at least once, no conversation yet." },
  connected: {
    label: "Connected",
    description: "A real conversation happened.",
    approximate:
      "This bucket is call-derived; the drill approximates it by each lead's latest outcome.",
  },
  callback: { label: "Callbacks", description: "Asked to be called back." },
  appointment: { label: "Appointments", description: "On the calendar." },
  converted: { label: "Converted", description: "Qualified out of the funnel." },
  exhausted: {
    label: "Exhausted",
    description: "Hit the campaign's max attempts.",
    approximate:
      "This bucket is call-derived from the retry policy; the drill approximates it by attempt count.",
  },
  dnc: { label: "DNC", description: "On the do-not-call list." },
  excluded: {
    label: "Excluded",
    description: "Archived, bad number, or a parked status.",
    approximate:
      "This bucket bundles several exclusions; the drill shows archived and invalid-phone leads.",
  },
};

// FilterSpec builders — every emitted condition must survive sanitizeFilterSpec
// unchanged (tests/campaign-policy.test.ts pins that), so `kind` is stamped
// exactly the way the sanitizer would.
const core = (key: FilterCondition["key"] & string, cmp: string, value?: unknown) =>
  ({ kind: "core", key, cmp, ...(value === undefined ? {} : { value }) }) as FilterCondition;
const derived = (key: FilterCondition["key"] & string, cmp: string, value?: unknown) =>
  ({ kind: "derived", key, cmp, ...(value === undefined ? {} : { value }) }) as FilterCondition;

/**
 * The /leads?f=… FilterSpec behind one funnel segment: the campaign pin plus
 * the stage's own condition(s). `maxAttempts` (when known and > 0) makes the
 * `exhausted` drill exact instead of "attempted at all."
 */
export function stageFilter(
  campaignId: string,
  stage: CampaignFunnelStage,
  opts?: { maxAttempts?: number },
): FilterSpec {
  const pin = core("campaign_id", "eq", campaignId);
  const and = (...conditions: FilterCondition[]): FilterSpec => ({
    op: "and",
    groups: [{ op: "and", conditions: [pin, ...conditions] }],
  });

  switch (stage) {
    case "eligible":
      return and(
        derived("dial_eligible", "is_true"),
        derived("never_dialed", "is_true"),
        derived("unassigned", "is_true"),
      );
    case "assigned":
      return and(core("assigned_rep_id", "not_empty"));
    case "attempted":
      return and(core("attempt_count", "gt", 0));
    case "connected":
      // The SQL bucket keys off call_records; latest_outcome is the closest
      // lead-side signal. Set membership mirrors CONNECTED_OUTCOMES exactly.
      return and(derived("latest_outcome", "in", [...CONNECTED_OUTCOMES]));
    case "callback":
      return and(core("status", "eq", "callback"));
    case "appointment":
      return and(core("status", "eq", "appointment"));
    case "converted":
      return and(core("status", "eq", "qualified"));
    case "exhausted": {
      const max = opts?.maxAttempts ?? 0;
      return max > 0
        ? and(core("attempt_count", "gte", max))
        : and(core("attempt_count", "gt", 0));
    }
    case "dnc":
      return and(derived("dnc", "is_true"));
    case "excluded":
      // Archived OR invalid phone — the bucket's two lead-side exclusions.
      return {
        op: "and",
        groups: [
          { op: "and", conditions: [pin] },
          {
            op: "or",
            conditions: [derived("archived", "is_true"), derived("phone_valid", "is_false")],
          },
        ],
      };
  }
}
