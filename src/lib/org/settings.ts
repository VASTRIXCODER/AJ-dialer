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
  leads: boolean;
  appointments: boolean;
  callbacks: boolean;
  liveMonitor: boolean;
  leaderboard: boolean;
  campaigns: boolean;
  reports: boolean;
  aiAgent: boolean;
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
    callerId: string;
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
    voice: string;
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
  /** Domain noun the dialer uses for a contact, e.g. "homeowner". */
  leadNoun: string;
  leadNounPlural: string;
}

export const DEFAULT_FEATURES: OrgFeatures = {
  aiDialer: true,
  leads: true,
  appointments: true,
  callbacks: true,
  liveMonitor: true,
  leaderboard: true,
  campaigns: true,
  reports: true,
  aiAgent: true,
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
  },
  hours: { startHour: 8, endHour: 20, days: [1, 2, 3, 4, 5] },
  ai: {
    agentName: "Aria",
    persona: "Friendly, concise, and consultative.",
    greeting: "Hi, this is {agent} calling from {org} — do you have a quick moment?",
    voice: "default",
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
  leadNoun: "lead",
  leadNounPlural: "leads",
};

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
