// ─────────────────────────────────────────────────────────────────────────────
// Domain model for the AIATWORK Solar Resolution Dialer
// ─────────────────────────────────────────────────────────────────────────────

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "appointment"
  | "callback"
  | "not_interested"
  | "no_answer"
  | "bills_fine"
  | "dnc";

/**
 * A lead-intake group KEY. Groups are defined per organization now (the
 * `lead_groups` table — see src/lib/db/lead-groups.ts), so this is an open
 * string rather than a closed union: an org's buckets are whatever its admins
 * created. A lead with no `leadGroup` is MISCELLANEOUS (lead_group IS NULL) —
 * either not sorted yet, or sorted and not confidently placed anywhere.
 */
export type LeadGroup = string;

/**
 * The four buckets of the ORIGINAL fixed geography taxonomy. Still real: they're
 * seeded into every org (see schema PART 17), they remain the only output of the
 * deterministic geo classifier used as the AI's offline fallback, and thousands
 * of existing leads carry these keys. New orgs are free to ignore them.
 */
export type GeoLeadGroup = "fresno" | "houston" | "dallas" | "california";
export const GEO_LEAD_GROUPS: GeoLeadGroup[] = ["fresno", "houston", "dallas", "california"];

/** The legacy fixed set, kept for seeding and back-compat with stored values. */
export const LEAD_GROUPS: LeadGroup[] = [...GEO_LEAD_GROUPS, "manual"];

/** Group key a human files by hand; the AI classifier must never assign it. */
export const MANUAL_GROUP_KEY = "manual";

export type CallOutcome =
  | "appointment_booked"
  | "callback_scheduled"
  | "qualified"
  | "not_interested"
  | "bills_fine"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "do_not_call";

export type CallDisposition = "answered" | "no_answer" | "voicemail" | "busy" | "failed";

/**
 * What a call is doing RIGHT NOW, as the Live Monitor shows it. Distinct from
 * CallOutcome, which is the verdict after it's over.
 *
 * Strictly monotonic — a call only ever moves forward through these:
 *
 *   initiated ──► ringing ──► in_progress ──► completed | failed
 *   we asked      their       they picked      over; has an outcome
 *   Twilio to     phone is    up; the talk     (or a failure_kind if it
 *   dial          ringing     timer starts     never really happened)
 *
 * Every writer must respect the order. Webhooks arrive out of order and land on
 * different serverless instances, so a late "ringing" event must never drag a
 * connected call backwards. Use liveStateRank() to compare.
 */
export type AILiveState =
  | "initiated"
  | "ringing"
  | "in_progress"
  | "completed"
  | "failed";

const LIVE_STATE_RANK: Record<AILiveState, number> = {
  initiated: 0,
  ringing: 1,
  in_progress: 2,
  completed: 3,
  failed: 3,
};

/** Position in the lifecycle. Higher wins; equal ranks are interchangeable. */
export function liveStateRank(state: string): number {
  return LIVE_STATE_RANK[state as AILiveState] ?? 0;
}

/** The states in which a call is still on the phone — i.e. shown as live. */
export const LIVE_STATES: readonly AILiveState[] = [
  "initiated",
  "ringing",
  "in_progress",
] as const;

/** True once the call is over and its verdict is final. */
export function isTerminalLiveState(state: string): boolean {
  return state === "completed" || state === "failed";
}

/**
 * What a rep is doing right now, for the manager's Team Status roster. Mirrors
 * DialerStatus (src/lib/use-dialer.ts).
 *
 * Lives here, not in presence-store.ts, because the roster is a client component
 * and presence-store.ts is `server-only`. A type-only import across that boundary
 * happens to survive (SWC erases it), but it puts a client component one value
 * import away from pulling the service-role client into the browser bundle.
 */
export type PresenceStatus = "idle" | "dialing" | "live" | "wrapup" | "ai";

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  utilityProvider: string;
  solarProvider: string;
  status: LeadStatus;
  campaignId: string;
  assignedRepId?: string;
  /** Key of an org-defined intake group. Absent = Miscellaneous (unsorted). */
  leadGroup?: LeadGroup;
  /** Pack this lead was dealt into — a numbered slice of one upload. Absent =
   *  not packed. Orthogonal to leadGroup: a lead can carry both. */
  leadPackId?: string;
  /**
   * Bare county name (e.g. "Fresno", never "Fresno County") computed
   * deterministically from `zip` at import time — see lib/leads/zip-county.ts.
   * Absent means either no ZIP was on file or the ZIP isn't in that lookup's
   * coverage, not "not in the US." Pair with `state` to disambiguate — several
   * county names repeat across states. Orthogonal to leadGroup: county is a
   * geographic fact, leadGroup is whatever bucket the org chose to sort into.
   */
  county?: string;
  /** Monthly solar loan / lease payment in USD */
  solarPayment?: number;
  /** Monthly utility bill in USD */
  utilityBill?: number;
  hasEV: boolean;
  hasPool: boolean;
  hasBattery: boolean;
  multipleSystems: boolean;
  notes?: string;
  lastContactedAt?: string;
  createdAt: string;
  /** Qualification confidence 0-100 produced by the AI agent */
  aiScore?: number;
  /** An IANA zone somebody actually CHOSE for this contact. Absent is the
   *  normal case — the column has a schema default, so a value that equals it
   *  is not evidence (see storedLeadTimezone). Consumers infer from the
   *  number's area code instead of assuming. */
  timezone?: string;
  /** The account (user id) that uploaded this lead — drives per-uploader scoping. */
  ownerId?: string;
  /** Uploader's display name, resolved for the supervisor's sectioned view. */
  ownerName?: string;
  /**
   * Arbitrary per-lead data captured from the CSV (leads.custom_fields jsonb),
   * keyed by normalized snake_case header, typed at import time. Rendered and
   * edited through the org's field schema — see src/lib/leads/field-schema.ts.
   */
  customFields?: Record<string, string | number | boolean>;
}

export interface Rep {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  initials: string;
  role: "rep" | "manager" | "admin";
  status: "on_call" | "available" | "wrap_up" | "break" | "offline";
  team: string;
  callsToday: number;
  conversationsToday: number;
  appointmentsToday: number;
  talkTimeMin: number;
  connectRate: number;
  /** Composite performance score 0-100 */
  score: number;
  currentLeadId?: string;
  callStartedAt?: string;
}

/** A rep's aggregated stats over one time window (today / 7d / 30d). */
export interface LeaderboardStat {
  calls: number;
  connects: number;
  appointments: number;
  callbacks: number;
  talkTimeMin: number;
  /** connects / calls, % */
  connectRate: number;
  /** appointments / connects, % */
  conversionRate: number;
  aiCalls: number;
  humanCalls: number;
  /** Composite performance score 0-100 */
  score: number;
}

/** One ranked team member on the org-wide leaderboard, with per-period stats. */
export interface LeaderboardEntry {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  role: string;
  team: string;
  daily: LeaderboardStat;
  weekly: LeaderboardStat;
  monthly: LeaderboardStat;
}

export interface Appointment {
  id: string;
  leadId: string;
  leadName: string;
  repId: string;
  repName: string;
  scheduledAt: string;
  durationMin: number;
  status: "scheduled" | "completed" | "no_show" | "rescheduled" | "cancelled";
  address: string;
  utilityBill: number;
  solarPayment: number;
  notes?: string;
  source: "rep" | "ai";
}

export interface Callback {
  id: string;
  leadId: string;
  leadName: string;
  phone: string;
  repId: string;
  repName: string;
  dueAt: string;
  reason: string;
  status: "due" | "upcoming" | "overdue" | "completed";
}

export type CampaignStatus = "active" | "paused" | "completed";

export interface Campaign {
  id: string;
  name: string;
  utilityProvider: string;
  status: CampaignStatus;
  totalLeads: number;
  activeLeads: number;
  completedLeads: number;
  appointments: number;
  contactRate: number;
  color: string;
  startedAt: string;
}

export interface CallRecord {
  id: string;
  leadId: string;
  leadName: string;
  repId: string;
  repName: string;
  phone: string;
  startedAt: string;
  durationSec: number;
  outcome: CallOutcome;
  disposition: CallDisposition;
  recordingUrl?: string;
  campaignId: string;
  hasSummary: boolean;
}

export interface ActiveCall {
  id: string;
  repId: string;
  repName: string;
  repInitials: string;
  repColor: string;
  leadName: string;
  leadCity: string;
  phone: string;
  startedAt: string;
  state: "ringing" | "connected" | "wrap_up";
  campaign: string;
  sentiment: "positive" | "neutral" | "negative";
}

export interface KpiPoint {
  label: string;
  calls: number;
  conversations: number;
  appointments: number;
  connectRate: number;
}

export interface MetricSummary {
  totalCalls: number;
  callsToday: number;
  connections: number;
  conversations: number;
  avgCallLenSec: number;
  connectRate: number;
  appointmentRate: number;
  callbackRate: number;
  noAnswerRate: number;
  appointmentsBooked: number;
  appointmentsCompleted: number;
  noShows: number;
  reschedules: number;
  avgUtilityBill: number;
  avgSolarPayment: number;
  avgTotalEnergyCost: number;
  evOwnership: number;
  poolOwnership: number;
  batteryOwnership: number;
}

export interface OutcomeOption {
  value: CallOutcome;
  label: string;
  description: string;
  tone: "success" | "warning" | "danger" | "neutral";
}
