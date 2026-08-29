// ─────────────────────────────────────────────────────────────────────────────
// Organization settings & white-label blueprint — PURE module (no server-only),
// so it can be imported from both Client and Server Components.
//
// `OrgSettings` is the deep, per-organization configuration persisted in the
// organizations.settings JSONB. `feature flags` let an org turn whole areas of
// the dialer on/off, so the product literally reshapes itself per tenant.
// `OrgBlueprint` is the full white-label spec the AI builder produces.
// ─────────────────────────────────────────────────────────────────────────────

import type { LeadFieldDef } from "../leads/field-schema";
import { sanitizeExportTemplates, type ExportTemplate } from "../leads/export-spec";

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

/**
 * Per-tenant customization of the dialer's right-hand qualification panel.
 * Solar orgs keep the solar-loan framing; non-solar tenants (e.g. a workspace
 * that isn't selling against a solar payment) turn the solar field off and
 * relabel the third home-profile toggle to something that fits their pitch.
 */
export interface QualifySettings {
  /** Show the "Solar payment" billing field + energy-cost total. */
  showSolarPayment: boolean;
  /** Label for the third home-profile toggle (default "Battery"). */
  otherToggleLabel: string;
  /**
   * Schema keys (see src/lib/leads/field-schema.ts) the qualify panel renders,
   * in order — core slots by their camelCase key, custom fields by their
   * snake_case key. Absent/empty = derive from the vertical template's
   * `qualifyFields` preset, falling back to every schema field flagged
   * `showInQualify`. Unknown keys are ignored at render time, so a field
   * deleted from the schema never breaks the panel.
   */
  fields?: string[];
}

/**
 * Which panels of the dialer page this workspace shows. All-on is today's
 * dialer; vertical templates preset a shape (e.g. healthcare hides the live
 * floor) and admins fine-tune from there. Stored PARTIAL by design: only keys
 * an admin explicitly saved persist, so anything untouched keeps following the
 * template preset — resolved in the (app) layout as
 * DEFAULT ⊕ template preset ⊕ stored overrides.
 */
export interface DialerLayout {
  /** Org-wide live floor strip (who's dialing right now, calls today). */
  floor: boolean;
  /** The "Booked" tab beside the dial queue. */
  bookedTab: boolean;
  /** Collapsible campaign-script card above the qualify panel. */
  scriptCard: boolean;
  /** AI lead briefing at the top of the qualify panel. */
  aiBriefing: boolean;
  /** Per-lead call history in the lead panel. */
  callHistory: boolean;
  /** "Up next in queue" preview in the lead panel. */
  upNext: boolean;
}

export const DEFAULT_DIALER_LAYOUT: DialerLayout = {
  floor: true,
  bookedTab: true,
  scriptCard: true,
  aiBriefing: true,
  callHistory: true,
  upNext: true,
};

export interface OrgSettings {
  dialing: {
    mode: "preview" | "progressive" | "predictive";
    maxLines: number;
    ringTimeoutSec: number;
    recording: boolean;
    /**
     * Async answering-machine detection on manual/parallel outbound legs.
     * Twilio's AsyncAmd never delays connecting a live human; when the verdict
     * says machine, the leg is auto-dropped (or gets the voicemail drop below).
     * Off by default: it adds per-minute AMD cost and changes floor behavior,
     * so an admin has to opt in.
     */
    amd: boolean;
    /** On AMD's end-of-greeting beep, speak `voicemailMessage` instead of hanging up. */
    voicemailDrop: boolean;
    /**
     * TTS text for the voicemail drop. Placeholders: {org}. Empty falls back
     * to a neutral default at drop time.
     */
    voicemailMessage: string;
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
    /**
     * Double-dial ("double tap"): when the AI bot gets a NO-ANSWER, ring the same
     * number once more after a short gap before moving on. Two missed calls in
     * quick succession read as an important call and lift pickup rate. Off by
     * default. Applies to the AI dialer only.
     */
    doubleDial: boolean;
    /** Seconds to wait after a no-answer before the second (double-tap) dial. */
    doubleDialGapSec: number;
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
  /**
   * Stored wrap-up rows. Two generations coexist in live blobs: the legacy
   * `{ label, tone }` pairs the old editor wrote, and the keyed rows the
   * Dispositions editor writes now (key/behavior/enabled/system/sortOrder —
   * see DispositionDef in src/lib/dispositions/defs.ts). NEVER read this array
   * raw — always resolve through resolveDispositionDefs, which round-trips
   * keyed rows and migrates legacy ones.
   */
  dispositions: {
    label: string;
    tone: DispositionTone;
    key?: string;
    behavior?: string;
    enabled?: boolean;
    system?: boolean;
    sortOrder?: number;
  }[];
  /** Qualification-panel customization (solar field + third toggle label). */
  qualify: QualifySettings;
  /**
   * Dialer-page layout toggles. PARTIAL on purpose: only the keys an admin has
   * explicitly saved live here — unset keys keep following the vertical
   * template's preset (see DEFAULT_DIALER_LAYOUT and the (app) layout).
   */
  dialerLayout: Partial<DialerLayout>;
  notifications: NotificationSettings;
  features: OrgFeatures;
  billing: OrgBilling;
  /** Per-minute call cost estimates — drives the Reports "Cost & usage" panel. */
  costRates: CostRates;
  /**
   * The org's lead field schema: custom fields discovered from CSV imports plus
   * any explicit overrides of the core slots. Empty = derive everything from the
   * vertical template's defaults (see resolveLeadFields in
   * src/lib/leads/field-schema.ts).
   */
  leadFields: LeadFieldDef[];
  /**
   * Saved Export v2 setups (column selection + format), managed from the leads
   * Export dialog. Capped at 20; sanitized on every read (mergeSettings) so a
   * hand-edited blob degrades to its valid templates instead of breaking the
   * dialog. See src/lib/leads/export-spec.ts.
   */
  exportTemplates: ExportTemplate[];
  /** Domain noun the dialer uses for a contact, e.g. "homeowner". */
  leadNoun: string;
  leadNounPlural: string;
  /**
   * Per-org display-label overrides for the fixed lead-group "dropboxes", keyed
   * by group key (e.g. {"fresno":"San Antonio"}). Display-only — the underlying
   * keys and the geo-classifier are global and untouched. Empty = default labels.
   */
  leadGroupLabels: Record<string, string>;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  // On by default, but with no recipients it is inert — an org that never opens
  // the panel gets no email and, importantly, no "delivery failed" alerts either.
  appointmentEmail: true,
  appointmentEmails: [],
  ccBookingRep: false,
  fromName: "",
};

export const DEFAULT_QUALIFY: QualifySettings = {
  showSolarPayment: true,
  otherToggleLabel: "Battery",
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

/**
 * What a minute of talk time costs this org, in USD — ESTIMATES, editable in
 * Admin → Organization settings. Defaults approximate common list pricing:
 * AI calls carry the conversational-AI per-minute fee plus the carrier leg;
 * human calls are just the carrier leg.
 */
export interface CostRates {
  aiPerMinute: number;
  manualPerMinute: number;
}

export const DEFAULT_COST_RATES: CostRates = {
  aiPerMinute: 0.1,
  manualPerMinute: 0.015,
};

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  dialing: {
    mode: "progressive",
    maxLines: 3,
    ringTimeoutSec: 25,
    recording: true,
    amd: false,
    voicemailDrop: true,
    voicemailMessage: "",
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
    doubleDial: false,
    doubleDialGapSec: 15,
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
  qualify: { ...DEFAULT_QUALIFY },
  dialerLayout: {},
  notifications: { ...DEFAULT_NOTIFICATIONS },
  features: { ...DEFAULT_FEATURES },
  billing: { ...DEFAULT_BILLING },
  costRates: { ...DEFAULT_COST_RATES },
  leadFields: [],
  exportTemplates: [],
  leadNoun: "lead",
  leadNounPlural: "leads",
  leadGroupLabels: {},
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
    qualify: {
      ...DEFAULT_QUALIFY,
      ...(s.qualify ?? {}),
      // Arrays replace wholesale, and anything that isn't an array is dropped
      // (undefined = "derive from the template's preset").
      fields: Array.isArray(s.qualify?.fields) ? s.qualify!.fields : undefined,
    },
    // Deliberately NOT back-filled with defaults: this section stays partial so
    // the (app) layout can layer it over the vertical template's preset —
    // back-filling `true` here would make every org look like it explicitly
    // chose all-on and the presets would never apply.
    dialerLayout:
      s.dialerLayout && typeof s.dialerLayout === "object" && !Array.isArray(s.dialerLayout)
        ? s.dialerLayout
        : {},
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
    costRates: { ...DEFAULT_COST_RATES, ...(s.costRates ?? {}) },
    // Arrays replace wholesale (like dispositions) — spread-merging would
    // resurrect a field an admin just deleted.
    leadFields: Array.isArray(s.leadFields) ? s.leadFields : [],
    // Sanitized on read (shape + the 20-template cap) — the stored blob is
    // whatever the PATCH route last wrote, and templates replace wholesale.
    exportTemplates: sanitizeExportTemplates(s.exportTemplates),
    leadNoun: s.leadNoun ?? DEFAULT_ORG_SETTINGS.leadNoun,
    leadNounPlural: s.leadNounPlural ?? DEFAULT_ORG_SETTINGS.leadNounPlural,
    leadGroupLabels:
      s.leadGroupLabels && typeof s.leadGroupLabels === "object"
        ? s.leadGroupLabels
        : {},
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
