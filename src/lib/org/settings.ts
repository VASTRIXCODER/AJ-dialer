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
  liveMonitor: boolean;
  leaderboard: boolean;
  campaigns: boolean;
  reports: boolean;
  aiAgent: boolean;
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
  };
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
  };
  compliance: {
    dncEnforced: boolean;
    recordingDisclosure: string;
    consentRequired: boolean;
  };
  dispositions: { label: string; tone: DispositionTone }[];
  features: OrgFeatures;
  billing: OrgBilling;
  /** Domain noun the dialer uses for a contact, e.g. "homeowner". */
  leadNoun: string;
  leadNounPlural: string;
}

export const DEFAULT_FEATURES: OrgFeatures = {
  aiDialer: true,
  manualDialer: true,
  leads: true,
  appointments: true,
  callbacks: true,
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
    hours: { ...DEFAULT_ORG_SETTINGS.hours, ...(s.hours ?? {}) },
    ai: { ...DEFAULT_ORG_SETTINGS.ai, ...(s.ai ?? {}) },
    compliance: { ...DEFAULT_ORG_SETTINGS.compliance, ...(s.compliance ?? {}) },
    dispositions: Array.isArray(s.dispositions)
      ? s.dispositions
      : DEFAULT_ORG_SETTINGS.dispositions,
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
