// ─────────────────────────────────────────────────────────────────────────────
// Organization settings & white-label blueprint — PURE module (no server-only),
// so it can be imported from both Client and Server Components.
//
// `OrgSettings` is the deep, per-organization configuration persisted in the
// organizations.settings JSONB. `feature flags` let an org turn whole areas of
// the dialer on/off, so the product literally reshapes itself per tenant.
// `OrgBlueprint` is the full white-label spec the AI builder produces.
// ─────────────────────────────────────────────────────────────────────────────

export type DispositionTone = "success" | "warning" | "danger" | "neutral";

export interface OrgFeatures {
  aiDialer: boolean;
  /** Browser-based manual (human) dialing. Off ⇒ AI-only workspace. */
  manualDialer: boolean;
  leads: boolean;
  appointments: boolean;
  callbacks: boolean;
  billsFine: boolean;
  liveMonitor: boolean;
  leaderboard: boolean;
  campaigns: boolean;
  reports: boolean;
  aiAgent: boolean;
}

/** One inclusive-start, exclusive-end hour window, e.g. {start:8,end:9} = 8–9am. */
export interface AutomationWindow {
  start: number;
  end: number;
}

/** Unattended AI-calling schedule (server-side cron places the calls). */
export interface AutomationSettings {
  /** Master switch — nothing auto-dials unless this is on. */
  enabled: boolean;
  /** IANA timezone the windows/days are evaluated in, e.g. "America/Chicago". */
  timezone: string;
  /** Days of week to run, 0 (Sun) – 6 (Sat). */
  days: number[];
  /** Hour windows to call within (local to `timezone`). */
  windows: AutomationWindow[];
  /** Calls placed per scheduler tick (~one tick/min → ~calls per minute). */
  callsPerRun: number;
  /** Max auto calls per day per org (0 = unlimited). */
  dailyCap: number;
  /** Don't re-dial a lead contacted within this many hours. */
  cooldownHours: number;
}

/**
 * Per-organization paywall, controlled by the platform owner (superadmin). There
 * is no payment processor — the owner sets the price and flips `active` to grant
 * or revoke access. While `paywall` is on and `active` is off, members see a
 * branded lock screen instead of the app.
 */
export interface OrgBilling {
  /** Is this workspace gated behind payment at all? */
  paywall: boolean;
  /** Superadmin switch: is access currently unlocked (paid)? */
  active: boolean;
  /** Price the platform owner charges (in whole currency units). */
  price: number;
  /** ISO-4217 currency code, e.g. "USD". */
  currency: string;
  interval: "month" | "year" | "once";
  /** Optional line shown on the lock screen (e.g. a contact or plan name). */
  note: string;
}

/**
 * Outbound email the workspace sends on its own — today, just the "an appointment
 * was set" alert to whoever owns the sales calendar.
 *
 * The recipients live HERE, in the org's settings, and not in an env var, because
 * the person who needs to change them is an admin looking at a screen, not an
 * engineer with deploy access. `APPOINTMENT_NOTIFY_EMAILS` remains as a
 * deployment-wide fallback for orgs that have never opened the panel.
 */
export interface NotificationSettings {
  /** Master switch. Off ⇒ appointments still book, nobody gets emailed. */
  appointmentEmail: boolean;
  /** Who gets told when an appointment is set / moved / cancelled. */
  appointmentEmails: string[];
  /** Also copy the rep who booked it, so they have their own paper trail. */
  ccBookingRep: boolean;
  /** Display name on the From line, e.g. "AIATWORK Dialer". */
  fromName: string;
}

export interface OrgSettings {
  dialing: {
    mode: "preview" | "progressive" | "predictive";
    maxLines: number;
    ringTimeoutSec: number;
    recording: boolean;
    voicemailDrop: boolean;
    retryAttempts: number;
    retryDelayMin: number;
    respectDnc: boolean;
    /** Primary outbound caller ID (used when the rotation pool is empty). */
    callerId: string;
    /**
     * Caller-ID rotation pool — a list of E.164 numbers the dialer cycles
     * through for BOTH manual and AI calls. Empty = always use `callerId`/env.
     */
    callerIds: string[];
    /** Switch to the next pool number after this many calls (min 1). */
    rotateEvery: number;
    /**
     * Local presence: prefer a pool number whose area code matches the lead's,
     * so the call looks local and gets answered more. Falls back to normal
     * rotation when no pool number shares the lead's area code.
     */
    localPresence: boolean;
  };
  /**
   * Unattended AI calling schedule. When enabled, a server-side cron places AI
   * calls to the org's dialable leads during the configured windows — no rep or
   * open browser required. Off by default so no org auto-dials unexpectedly.
   */
  automation: AutomationSettings;
  hours: {
    startHour: number; // 0–23 local to the org timezone
    endHour: number;
    days: number[]; // 0 (Sun) – 6 (Sat)
  };
  ai: {
    agentName: string;
    persona: string;
    greeting: string;
    /** Full system prompt for the AI caller. Empty = use the vertical default. */
    systemPrompt: string;
    voice: string;
    /** TTS playback speed (0.7 slow – 1.2 fast). Lower sounds calmer/slower. */
    voiceSpeed: number;
    transferNumber: string;
    aiFirst: boolean;
    maxTalkMin: number;
    language: string;
    /**
     * How many AI calls may be LIVE at once — the org's voice-plan concurrency
     * allowance. The dialer holds itself to this number.
     *
     * It matters that this is a REAL ceiling: the dialer used to launch a fresh
     * batch every 8 seconds regardless of whether prior calls had ended, so a
     * "3X" setting peaked near 70 simultaneous calls and burned credits at a
     * rate nobody chose. Set this to whatever the plan actually allows.
     */
    maxConcurrentCalls: number;
  };
  compliance: {
    dncEnforced: boolean;
    recordingDisclosure: string;
    consentRequired: boolean;
  };
  dispositions: { label: string; tone: DispositionTone }[];
  notifications: NotificationSettings;
  features: OrgFeatures;
  billing: OrgBilling;
  /** Domain noun the dialer uses for a contact, e.g. "homeowner". */
  leadNoun: string;
  leadNounPlural: string;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  // On by default, but with no recipients it is inert — an org that never opens
  // the panel gets no email and, importantly, no "delivery failed" alerts either.
  appointmentEmail: true,
  appointmentEmails: [],
  ccBookingRep: false,
  fromName: "",
};

export const DEFAULT_FEATURES: OrgFeatures = {
  aiDialer: true,
  manualDialer: true,
  leads: true,
  appointments: true,
  callbacks: true,
  billsFine: true,
  liveMonitor: true,
  leaderboard: true,
  campaigns: true,
  reports: true,
  aiAgent: true,
};

export const DEFAULT_BILLING: OrgBilling = {
  paywall: false,
  active: true,
  price: 0,
  currency: "USD",
  interval: "month",
  note: "",
};

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  dialing: {
    mode: "progressive",
    maxLines: 3,
    ringTimeoutSec: 25,
    recording: true,
    voicemailDrop: true,
    retryAttempts: 3,
    retryDelayMin: 60,
    respectDnc: true,
    callerId: "",
    callerIds: [],
    rotateEvery: 1,
    // On by default: when the pool holds a number in the lead's area code, dial
    // from it so the call shows as local and is answered more (and is flagged as
    // spam less). No-ops safely when the pool has no matching area code, so it's
    // safe to default on and pays off the moment regional numbers are added.
    localPresence: true,
  },
  automation: {
    enabled: false,
    timezone: "America/Chicago",
    days: [0, 1, 2, 3, 4, 5, 6],
    // 8–9am, 11am–3pm, 5–7pm (end hour is exclusive).
    windows: [
      { start: 8, end: 9 },
      { start: 11, end: 15 },
      { start: 17, end: 19 },
    ],
    callsPerRun: 3,
    dailyCap: 500,
    cooldownHours: 6,
  },
  hours: { startHour: 8, endHour: 20, days: [1, 2, 3, 4, 5] },
  ai: {
    agentName: "Aria",
    persona: "Friendly, concise, and consultative.",
    greeting: "Hi, this is {agent} calling from {org} — do you have a quick moment?",
    systemPrompt: "",
    voice: "default",
    voiceSpeed: 0.9,
    transferNumber: "+14693018199",
    aiFirst: true,
    maxTalkMin: 8,
    language: "en",
    // Matches the common ElevenLabs plan allowance. Raise if the plan does.
    maxConcurrentCalls: 10,
  },
  compliance: {
    dncEnforced: true,
    recordingDisclosure: "This call may be recorded for quality and training.",
    consentRequired: false,
  },
  dispositions: [
    { label: "Appointment booked", tone: "success" },
    { label: "Callback scheduled", tone: "warning" },
    { label: "Not interested", tone: "danger" },
    { label: "No answer", tone: "neutral" },
  ],
  notifications: { ...DEFAULT_NOTIFICATIONS },
  features: { ...DEFAULT_FEATURES },
  billing: { ...DEFAULT_BILLING },
  leadNoun: "lead",
  leadNounPlural: "leads",
};

/** Why the AI dialer is locked for a viewer: a plan upgrade vs a role limit. */
export type AiLockReason = "premium" | "role" | null;

export interface DialerAccess {
  manualEnabled: boolean;
  aiEnabled: boolean;
  aiLockReason: AiLockReason;
}

/**
 * Resolve which dialer modes a viewer may use, from the org's feature flags and
 * whether they hold the `dialer.ai` permission. Two independent gates on AI:
 *  • `aiDialer` off ⇒ AI is a locked premium feature for everyone (paywall).
 *  • no AI permission ⇒ AI is manager+ only (reps are manual-only) — UNLESS the
 *    workspace is AI-only (manual off), where reps must keep AI or be stranded.
 */
export function resolveDialerAccess(
  features: OrgFeatures,
  hasAiPermission: boolean,
): DialerAccess {
  const manualEnabled = features.manualDialer !== false;
  const aiOrgEnabled = features.aiDialer !== false;
  const aiRoleAllowed = hasAiPermission || !manualEnabled;
  const aiEnabled = aiOrgEnabled && aiRoleAllowed;
  const aiLockReason: AiLockReason = aiEnabled
    ? null
    : !aiOrgEnabled
      ? "premium"
      : "role";
  return { manualEnabled, aiEnabled, aiLockReason };
}

/** Deep-merge a stored (partial) settings blob over the defaults. */
export function mergeSettings(raw: unknown): OrgSettings {
  const s = (raw ?? {}) as Partial<OrgSettings>;
  return {
    dialing: { ...DEFAULT_ORG_SETTINGS.dialing, ...(s.dialing ?? {}) },
    automation: {
      ...DEFAULT_ORG_SETTINGS.automation,
      ...(s.automation ?? {}),
      // Arrays must be replaced wholesale, not spread-merged.
      days: Array.isArray(s.automation?.days)
        ? s.automation!.days
        : DEFAULT_ORG_SETTINGS.automation.days,
      windows: Array.isArray(s.automation?.windows)
        ? s.automation!.windows
        : DEFAULT_ORG_SETTINGS.automation.windows,
    },
    hours: { ...DEFAULT_ORG_SETTINGS.hours, ...(s.hours ?? {}) },
    ai: { ...DEFAULT_ORG_SETTINGS.ai, ...(s.ai ?? {}) },
    compliance: { ...DEFAULT_ORG_SETTINGS.compliance, ...(s.compliance ?? {}) },
    dispositions: Array.isArray(s.dispositions)
      ? s.dispositions
      : DEFAULT_ORG_SETTINGS.dispositions,
    notifications: {
      ...DEFAULT_NOTIFICATIONS,
      ...(s.notifications ?? {}),
      // Arrays replace wholesale — spreading would merge index-wise and resurrect
      // a recipient the admin just deleted.
      appointmentEmails: Array.isArray(s.notifications?.appointmentEmails)
        ? s.notifications!.appointmentEmails
        : DEFAULT_NOTIFICATIONS.appointmentEmails,
    },
    features: { ...DEFAULT_FEATURES, ...(s.features ?? {}) },
    billing: { ...DEFAULT_BILLING, ...(s.billing ?? {}) },
    leadNoun: s.leadNoun ?? DEFAULT_ORG_SETTINGS.leadNoun,
    leadNounPlural: s.leadNounPlural ?? DEFAULT_ORG_SETTINGS.leadNounPlural,
  };
}

/** Full white-label specification the AI builder emits and create applies. */
export interface OrgBlueprint {
  name: string;
  industry: string;
  template: string;
  productName: string;
  tagline: string;
  description: string;
  brandColor: string;
  accentColor: string;
  requireApproval: boolean;
  defaultRole: "rep" | "manager" | "admin";
  settings: OrgSettings;
}
