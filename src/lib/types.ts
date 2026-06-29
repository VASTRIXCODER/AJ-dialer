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
  timezone: string;
  /** The account (user id) that uploaded this lead — drives per-uploader scoping. */
  ownerId?: string;
  /** Uploader's display name, resolved for the supervisor's sectioned view. */
  ownerName?: string;
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

export interface Campaign {
  id: string;
  name: string;
  utilityProvider: string;
  status: "active" | "paused" | "completed";
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
