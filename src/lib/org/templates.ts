// Dialer specializations. Pure data so it is shared by onboarding, the Hub, the
// admin customization screen and the AI white-label builder. Each profile gives
// the dialer its vertical personality: terminology, default brand colors, the AI
// agent's persona, suggested dispositions, and optional feature toggles.

import type { CoreFieldOverrides } from "../leads/field-schema";
import type { DialerLayout, DispositionTone, OrgFeatures, QualifySettings } from "./settings";
import { isSolarVertical } from "./vertical";

export interface TemplateProfile {
  value: string;
  label: string;
  blurb: string;
  leadNoun: string;
  leadNounPlural: string;
  /**
   * What this vertical calls the meeting a rep books. Absent ⇒ "appointment".
   * Solar books an "account review"; real estate books a "showing"; recruiting
   * books an "interview" — writing "appointment" everywhere is not wrong so much
   * as foreign, and writing "account review" everywhere is somebody else's word.
   */
  appointmentNoun?: string;
  appointmentNounPlural?: string;
  /**
   * What the `bills_fine` disposition is called here. The stored key can't move
   * (it's on historical call records), but the label can and must — "Bills are
   * fine" is meaningless on a recruiting or healthcare call. Absent ⇒ a neutral
   * "No need right now".
   */
  noNeedLabel?: string;
  brandColor: string;
  accentColor: string;
  agentName: string;
  persona: string;
  greeting: string;
  dispositions: { label: string; tone: DispositionTone }[];
  /** Feature flags to flip off for this vertical (everything else stays on). */
  features?: Partial<OrgFeatures>;
  /**
   * Core-slot presentation for this vertical: relabels and hides applied over
   * CORE_LEAD_FIELDS (see resolveLeadFields in src/lib/leads/field-schema.ts).
   * The typed columns never change — insurance's "Current premium ($/mo)" is
   * the same currency slot solar calls "Utility bill ($/mo)". Absent = solar's
   * original labels (the solar template intentionally has no overrides).
   */
  fields?: CoreFieldOverrides;
  /**
   * Schema keys the dialer's qualify panel renders, in order. Absent = every
   * schema field flagged showInQualify. Org settings.qualify.fields (when
   * non-empty) win over this preset.
   */
  qualifyFields?: string[];
  /**
   * Dialer-page panels to flip OFF for this vertical (everything else stays
   * on). Org settings.dialerLayout keys win over this preset.
   */
  dialerLayout?: Partial<DialerLayout>;
}

const D = (label: string, tone: DispositionTone) => ({ label, tone });

export const TEMPLATE_PROFILES: TemplateProfile[] = [
  {
    value: "general",
    label: "General",
    blurb: "All-purpose AI auto-dialer.",
    leadNoun: "lead",
    leadNounPlural: "leads",
    appointmentNoun: "appointment",
    appointmentNounPlural: "appointments",
    noNeedLabel: "No need right now",
    brandColor: "#2563eb",
    accentColor: "#06b6d4",
    agentName: "Aria",
    persona: "Friendly, concise and consultative. Qualifies interest quickly.",
    greeting: "Hi, this is {agent} from {org} — do you have a quick moment?",
    dispositions: [
      D("Appointment booked", "success"),
      D("Callback scheduled", "warning"),
      D("Not interested", "danger"),
      D("No answer", "neutral"),
    ],
    // Vertical-neutral: one "Monthly bill" money slot, generic profile chips.
    // hasBattery → "Other" mirrors the pre-schema non-solar qualify toggle.
    fields: {
      labels: {
        utilityBill: "Monthly bill ($/mo)",
        utilityProvider: "Provider",
        hasBattery: "Other",
      },
      hidden: ["solarPayment", "solarProvider"],
    },
  },
  {
    value: "solar",
    label: "Solar",
    blurb: "Residential solar resolution & sales.",
    leadNoun: "homeowner",
    leadNounPlural: "homeowners",
    appointmentNoun: "account review",
    appointmentNounPlural: "account reviews",
    noNeedLabel: "Bills are fine",
    brandColor: "#f59e0b",
    accentColor: "#0ea5e9",
    agentName: "Sunny",
    persona:
      "Warm, knowledgeable about solar savings, utility bills and incentives. Books in-home reviews.",
    greeting:
      "Hi, this is {agent} with {org} — I'm reaching out about your solar account, do you have a moment?",
    dispositions: [
      D("Appointment booked", "success"),
      D("Callback scheduled", "warning"),
      D("Already resolved", "neutral"),
      D("Not interested", "danger"),
      D("No answer", "neutral"),
    ],
    // No `fields` / `qualifyFields` / `dialerLayout` on purpose: solar IS the
    // core schema's default presentation — the flagship tenant keeps today's
    // dialer exactly.
  },
  {
    value: "insurance",
    label: "Insurance",
    blurb: "Policy quoting & renewals.",
    leadNoun: "policyholder",
    leadNounPlural: "policyholders",
    appointmentNoun: "policy review",
    appointmentNounPlural: "policy reviews",
    noNeedLabel: "Happy with current cover",
    brandColor: "#4f46e5",
    accentColor: "#22d3ee",
    agentName: "Quinn",
    persona: "Trustworthy and clear about coverage, quotes and renewals.",
    greeting: "Hi, this is {agent} from {org} regarding your policy — is now a good time?",
    dispositions: [
      D("Quote requested", "success"),
      D("Renewal booked", "success"),
      D("Callback scheduled", "warning"),
      D("Not interested", "danger"),
      D("No answer", "neutral"),
    ],
    fields: {
      labels: {
        utilityBill: "Current premium ($/mo)",
        utilityProvider: "Current carrier",
        hasEV: "Multi-vehicle",
        hasPool: "Homeowner",
        hasBattery: "Bundle interest",
      },
      hidden: ["solarPayment", "solarProvider"],
    },
    // Carrier goes in the qualify flow — "who are you with today?" is the
    // first quoting question.
    qualifyFields: ["utilityBill", "utilityProvider", "hasEV", "hasPool", "hasBattery"],
  },
  {
    value: "real_estate",
    label: "Real Estate",
    blurb: "Buyer & seller outreach.",
    leadNoun: "prospect",
    leadNounPlural: "prospects",
    appointmentNoun: "showing",
    appointmentNounPlural: "showings",
    noNeedLabel: "Not moving right now",
    brandColor: "#059669",
    accentColor: "#34d399",
    agentName: "Riley",
    persona: "Personable local-market expert who books showings and listing consults.",
    greeting: "Hi, this is {agent} with {org} — are you still exploring the market?",
    dispositions: [
      D("Showing booked", "success"),
      D("Follow-up scheduled", "warning"),
      D("Not interested", "danger"),
      D("No answer", "neutral"),
    ],
    fields: {
      labels: {
        utilityBill: "Current mortgage ($/mo)",
        hasEV: "Pre-approved",
        hasPool: "Pool",
        hasBattery: "Owns home",
      },
      hidden: ["solarPayment", "solarProvider", "utilityProvider"],
    },
  },
  {
    value: "home_services",
    label: "Home Services",
    blurb: "Estimates & scheduling.",
    leadNoun: "customer",
    leadNounPlural: "customers",
    appointmentNoun: "estimate",
    appointmentNounPlural: "estimates",
    noNeedLabel: "No work needed",
    brandColor: "#ea580c",
    accentColor: "#f59e0b",
    agentName: "Jordan",
    persona: "Helpful and efficient at booking estimates and service visits.",
    greeting: "Hi, this is {agent} from {org} — calling to schedule your estimate.",
    dispositions: [
      D("Estimate booked", "success"),
      D("Callback scheduled", "warning"),
      D("Not interested", "danger"),
      D("No answer", "neutral"),
    ],
    fields: {
      labels: {
        utilityBill: "Est. job value ($)",
        utilityProvider: "Current provider",
        hasEV: "Repeat customer",
        hasPool: "Pool",
        hasBattery: "Maintenance plan",
      },
      hidden: ["solarPayment", "solarProvider"],
    },
  },
  {
    value: "healthcare",
    label: "Healthcare",
    blurb: "Appointment & intake calls.",
    leadNoun: "patient",
    leadNounPlural: "patients",
    appointmentNoun: "appointment",
    appointmentNounPlural: "appointments",
    noNeedLabel: "Nothing needed",
    brandColor: "#0d9488",
    accentColor: "#2dd4bf",
    agentName: "Sam",
    persona: "Calm, HIPAA-minded and reassuring when confirming appointments.",
    greeting: "Hello, this is {agent} from {org} calling about your appointment.",
    dispositions: [
      D("Appointment booked", "success"),
      D("Callback scheduled", "warning"),
      D("Declined", "danger"),
      D("No answer", "neutral"),
    ],
    features: { campaigns: false, leaderboard: false },
    // No money talk on a patient call; profile chips carry intake state.
    fields: {
      labels: {
        hasEV: "Insurance on file",
        hasPool: "New patient",
        hasBattery: "Needs follow-up",
      },
      hidden: ["utilityBill", "solarPayment", "utilityProvider", "solarProvider"],
    },
    // Same privacy-minded posture as its leaderboard-off feature preset: no
    // org-wide floor broadcasting who's being called; campaigns are off, so the
    // script card is explicit-off too.
    dialerLayout: { floor: false, scriptCard: false },
  },
  {
    value: "finance",
    label: "Financial Services",
    blurb: "Lending & advisory outreach.",
    leadNoun: "client",
    leadNounPlural: "clients",
    appointmentNoun: "consultation",
    appointmentNounPlural: "consultations",
    noNeedLabel: "Happy with current setup",
    brandColor: "#1d4ed8",
    accentColor: "#38bdf8",
    agentName: "Morgan",
    persona: "Professional and compliant about lending, rates and advisory.",
    greeting: "Hi, this is {agent} from {org} — do you have a moment to talk options?",
    dispositions: [
      D("Consultation booked", "success"),
      D("Callback scheduled", "warning"),
      D("Not qualified", "neutral"),
      D("Not interested", "danger"),
      D("No answer", "neutral"),
    ],
    fields: {
      labels: {
        utilityBill: "Monthly debt payment ($/mo)",
        utilityProvider: "Current lender",
        hasEV: "Homeowner",
        hasPool: "Retirement account",
        hasBattery: "Self-employed",
      },
      hidden: ["solarPayment", "solarProvider"],
    },
    qualifyFields: ["utilityBill", "utilityProvider", "hasEV", "hasPool", "hasBattery"],
  },
  {
    value: "automotive",
    label: "Automotive",
    blurb: "Sales & service follow-ups.",
    leadNoun: "customer",
    leadNounPlural: "customers",
    appointmentNoun: "appointment",
    appointmentNounPlural: "appointments",
    noNeedLabel: "Happy with current vehicle",
    brandColor: "#dc2626",
    accentColor: "#f97316",
    agentName: "Casey",
    persona: "Energetic about test drives, trade-ins and service specials.",
    greeting: "Hi, this is {agent} from {org} — calling about your vehicle.",
    dispositions: [
      D("Test drive booked", "success"),
      D("Service booked", "success"),
      D("Callback scheduled", "warning"),
      D("Not interested", "danger"),
      D("No answer", "neutral"),
    ],
    fields: {
      labels: {
        utilityBill: "Current payment ($/mo)",
        utilityProvider: "Current vehicle",
        hasEV: "Has trade-in",
        hasPool: "Lease ending",
        hasBattery: "Service due",
      },
      hidden: ["solarPayment", "solarProvider"],
    },
    qualifyFields: ["utilityBill", "utilityProvider", "hasEV", "hasPool", "hasBattery"],
  },
  {
    value: "recruiting",
    label: "Recruiting",
    blurb: "Candidate screening calls.",
    leadNoun: "candidate",
    leadNounPlural: "candidates",
    appointmentNoun: "interview",
    appointmentNounPlural: "interviews",
    noNeedLabel: "Not looking right now",
    brandColor: "#7c3aed",
    accentColor: "#a78bfa",
    agentName: "Avery",
    persona: "Engaging screener who qualifies candidates and books interviews.",
    greeting: "Hi, this is {agent} from {org} about an opportunity — got a minute?",
    dispositions: [
      D("Interview booked", "success"),
      D("Callback scheduled", "warning"),
      D("Not a fit", "neutral"),
      D("Not interested", "danger"),
      D("No answer", "neutral"),
    ],
    features: { campaigns: false },
    fields: {
      labels: {
        utilityBill: "Desired pay ($)",
        hasEV: "Open to relocate",
        hasPool: "Remote OK",
        hasBattery: "Actively looking",
      },
      hidden: ["solarPayment", "solarProvider", "utilityProvider"],
    },
    // Campaigns are off for recruiting, so no campaign script card either.
    dialerLayout: { scriptCard: false },
  },
  {
    value: "education",
    label: "Education",
    blurb: "Enrollment & admissions.",
    leadNoun: "student",
    leadNounPlural: "students",
    appointmentNoun: "info session",
    appointmentNounPlural: "info sessions",
    noNeedLabel: "Not enrolling right now",
    brandColor: "#0284c7",
    accentColor: "#38bdf8",
    agentName: "Taylor",
    persona: "Supportive admissions guide who books info sessions and enrollments.",
    greeting: "Hi, this is {agent} from {org} — calling about your application.",
    dispositions: [
      D("Info session booked", "success"),
      D("Callback scheduled", "warning"),
      D("Not interested", "danger"),
      D("No answer", "neutral"),
    ],
    fields: {
      labels: {
        utilityBill: "Tuition budget ($)",
        utilityProvider: "Current school",
        hasEV: "Financial aid",
        hasPool: "Transfer credits",
        hasBattery: "Parent contact",
      },
      hidden: ["solarPayment", "solarProvider"],
    },
  },
];

export interface DialerTemplate {
  value: string;
  label: string;
  blurb: string;
}

/** Lightweight list for simple selects. */
export const DIALER_TEMPLATES: DialerTemplate[] = TEMPLATE_PROFILES.map((t) => ({
  value: t.value,
  label: t.label,
  blurb: t.blurb,
}));

export function templateProfile(value: string | undefined | null): TemplateProfile {
  return (
    TEMPLATE_PROFILES.find((t) => t.value === value) ?? TEMPLATE_PROFILES[0]
  );
}

/**
 * The stored settings that only make sense for SOLAR, resolved per vertical.
 *
 * `isSolarVertical` already hides solar wording at render time, but the stored
 * settings were still seeded from the flagship solar tenant's shape: a fresh
 * "General" / "Insurance" / "Recruiting" workspace started with the solar
 * payment field switched on and the "Bills are fine" pipeline stage in its nav
 * — a stage that only means anything when you're selling against a solar loan.
 * New orgs now persist the shape their own vertical actually wants, so an admin
 * never has to go turn solar off by hand.
 */
export function verticalDefaults(template: string | undefined | null): {
  qualify: QualifySettings;
  features: Partial<OrgFeatures>;
} {
  const isSolar = isSolarVertical(template);
  return {
    qualify: {
      showSolarPayment: isSolar,
      otherToggleLabel: isSolar ? "Battery" : "Other",
    },
    features: isSolar ? {} : { billsFine: false },
  };
}

export function templateLabel(value: string): string {
  return templateProfile(value).label;
}
