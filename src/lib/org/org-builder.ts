import "server-only";

import { generateJSON, isAIConfigured } from "../ai/claude";
import {
  DEFAULT_FEATURES,
  DEFAULT_ORG_SETTINGS,
  type DispositionTone,
  type OrgBlueprint,
  type OrgFeatures,
  mergeSettings,
} from "./settings";
import { DIALER_TEMPLATES, templateProfile, verticalDefaults } from "./templates";

// ─────────────────────────────────────────────────────────────────────────────
// AI white-label builder. Turns a plain-English business description into a full
// OrgBlueprint that the create flow applies — name, branding, AI agent persona,
// dispositions, feature set & vertical. Uses Claude when configured; otherwise a
// deterministic, keyword-driven heuristic so it always works.
// ─────────────────────────────────────────────────────────────────────────────

const TONES: DispositionTone[] = ["success", "warning", "danger", "neutral"];

const TEMPLATE_KEYWORDS: { template: string; words: string[] }[] = [
  { template: "solar", words: ["solar", "panel", "renewable", "photovoltaic"] },
  { template: "insurance", words: ["insurance", "policy", "coverage", "underwrit"] },
  { template: "real_estate", words: ["real estate", "realtor", "realty", "listing", "broker", "property"] },
  { template: "home_services", words: ["hvac", "plumb", "roof", "landscap", "remodel", "contractor", "home service", "pest"] },
  { template: "healthcare", words: ["health", "clinic", "dental", "medical", "patient", "wellness", "therapy"] },
  { template: "finance", words: ["loan", "mortgage", "bank", "lend", "financ", "wealth", "advisor", "credit"] },
  { template: "automotive", words: ["car", "auto", "dealership", "vehicle", "motors"] },
  { template: "recruiting", words: ["recruit", "staffing", "hiring", "talent", "candidate"] },
  { template: "education", words: ["school", "college", "university", "academy", "admission", "student", "education", "course"] },
];

function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v.trim());
}
function normalizeHex(v: unknown, fallback: string): string {
  if (!isHex(v)) return fallback;
  const s = (v as string).trim();
  return s.startsWith("#") ? s : `#${s}`;
}

function pickTemplate(text: string): string {
  const lower = text.toLowerCase();
  for (const { template, words } of TEMPLATE_KEYWORDS) {
    if (words.some((w) => lower.includes(w))) return template;
  }
  return "general";
}

/** Deterministic blueprint from the vertical profile — the always-available path. */
export function heuristicBlueprint(
  description: string,
  hints: { name?: string; industry?: string } = {},
): OrgBlueprint {
  const template = pickTemplate(`${hints.industry ?? ""} ${description}`);
  const p = templateProfile(template);
  const v = verticalDefaults(template);
  const name = (hints.name || "New Organization").trim();
  const settings = mergeSettings({
    ...DEFAULT_ORG_SETTINGS,
    ai: {
      ...DEFAULT_ORG_SETTINGS.ai,
      agentName: p.agentName,
      persona: p.persona,
      greeting: p.greeting,
    },
    dispositions: p.dispositions,
    qualify: v.qualify,
    features: { ...DEFAULT_FEATURES, ...v.features, ...(p.features ?? {}) },
    leadNoun: p.leadNoun,
    leadNounPlural: p.leadNounPlural,
  });
  return {
    name,
    industry: hints.industry || p.label,
    template,
    productName: `${name} Dialer`,
    tagline: p.blurb,
    description: description.trim() || p.blurb,
    brandColor: p.brandColor,
    accentColor: p.accentColor,
    requireApproval: true,
    defaultRole: "rep",
    settings,
  };
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "industry",
    "template",
    "productName",
    "tagline",
    "description",
    "brandColor",
    "accentColor",
    "leadNoun",
    "leadNounPlural",
    "agentName",
    "agentPersona",
    "greeting",
    "dispositions",
    "features",
  ],
  properties: {
    name: { type: "string" },
    industry: { type: "string" },
    template: { type: "string", enum: DIALER_TEMPLATES.map((t) => t.value) },
    productName: { type: "string" },
    tagline: { type: "string" },
    description: { type: "string" },
    brandColor: { type: "string", description: "Hex color like #2563eb" },
    accentColor: { type: "string", description: "Hex color like #06b6d4" },
    leadNoun: { type: "string", description: "Singular noun for a contact, e.g. homeowner" },
    leadNounPlural: { type: "string" },
    agentName: { type: "string" },
    agentPersona: { type: "string" },
    greeting: { type: "string", description: "Use {agent} and {org} placeholders" },
    dispositions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "tone"],
        properties: {
          label: { type: "string" },
          tone: { type: "string", enum: TONES },
        },
      },
    },
    features: {
      type: "object",
      additionalProperties: false,
      required: [
        "aiDialer",
        "leads",
        "appointments",
        "callbacks",
        "liveMonitor",
        "leaderboard",
        "campaigns",
        "reports",
        "aiAgent",
      ],
      properties: {
        aiDialer: { type: "boolean" },
        leads: { type: "boolean" },
        appointments: { type: "boolean" },
        callbacks: { type: "boolean" },
        liveMonitor: { type: "boolean" },
        leaderboard: { type: "boolean" },
        campaigns: { type: "boolean" },
        reports: { type: "boolean" },
        aiAgent: { type: "boolean" },
      },
    },
  },
} as const;

interface AISpec {
  name: string;
  industry: string;
  template: string;
  productName: string;
  tagline: string;
  description: string;
  brandColor: string;
  accentColor: string;
  leadNoun: string;
  leadNounPlural: string;
  agentName: string;
  agentPersona: string;
  greeting: string;
  dispositions: { label: string; tone: string }[];
  features: Record<keyof OrgFeatures, boolean>;
}

/**
 * Produce a complete white-label blueprint from a free-text business
 * description. Always returns something usable; `source` says whether Claude or
 * the heuristic produced it.
 */
export async function generateOrgBlueprint(
  description: string,
  hints: { name?: string; industry?: string } = {},
): Promise<{ blueprint: OrgBlueprint; source: "claude" | "heuristic" }> {
  const base = heuristicBlueprint(description, hints);
  if (!isAIConfigured()) return { blueprint: base, source: "heuristic" };

  try {
    const spec = await generateJSON<AISpec>({
      schemaName: "org_blueprint",
      schema: SCHEMA as unknown as Record<string, unknown>,
      effort: "medium",
      maxTokens: 1600,
      system:
        "You are a white-label onboarding architect for an AI auto-dialer product. " +
        "Given a business description, design a tasteful, production-ready org configuration: " +
        "a fitting vertical template, brand identity, an AI calling agent persona & greeting, " +
        "realistic call dispositions, and which dialer features to enable. " +
        "Choose brand colors that suit the industry (valid 6-digit hex). Keep copy crisp and professional.",
      prompt:
        `Business description: ${description}\n` +
        (hints.name ? `Preferred organization name: ${hints.name}\n` : "") +
        (hints.industry ? `Industry hint: ${hints.industry}\n` : "") +
        "Design the organization now.",
    });

    const template = DIALER_TEMPLATES.some((t) => t.value === spec.template)
      ? spec.template
      : base.template;
    const p = templateProfile(template);

    const dispositions =
      Array.isArray(spec.dispositions) && spec.dispositions.length
        ? spec.dispositions.slice(0, 8).map((d) => ({
            label: String(d.label || "Outcome").slice(0, 40),
            tone: (TONES.includes(d.tone as DispositionTone)
              ? d.tone
              : "neutral") as DispositionTone,
          }))
        : p.dispositions;

    const v = verticalDefaults(template);
    const features: OrgFeatures = {
      aiDialer: spec.features?.aiDialer ?? true,
      manualDialer: spec.features?.manualDialer ?? true,
      leads: spec.features?.leads ?? true,
      appointments: spec.features?.appointments ?? true,
      callbacks: spec.features?.callbacks ?? true,
      // "Bills are fine" is a solar objection stage — never on for other verticals.
      billsFine: (spec.features?.billsFine ?? true) && v.features.billsFine !== false,
      liveMonitor: spec.features?.liveMonitor ?? true,
      leaderboard: spec.features?.leaderboard ?? true,
      campaigns: spec.features?.campaigns ?? true,
      reports: spec.features?.reports ?? true,
      aiAgent: spec.features?.aiAgent ?? true,
    };

    const name = (hints.name || spec.name || base.name).trim();
    const settings = mergeSettings({
      ...DEFAULT_ORG_SETTINGS,
      ai: {
        ...DEFAULT_ORG_SETTINGS.ai,
        agentName: spec.agentName || p.agentName,
        persona: spec.agentPersona || p.persona,
        greeting: spec.greeting || p.greeting,
      },
      dispositions,
      qualify: v.qualify,
      features,
      leadNoun: spec.leadNoun || p.leadNoun,
      leadNounPlural: spec.leadNounPlural || p.leadNounPlural,
    });

    return {
      blueprint: {
        name,
        industry: spec.industry || hints.industry || p.label,
        template,
        productName: spec.productName || `${name} Dialer`,
        tagline: spec.tagline || p.blurb,
        description: spec.description || description.trim() || p.blurb,
        brandColor: normalizeHex(spec.brandColor, p.brandColor),
        accentColor: normalizeHex(spec.accentColor, p.accentColor),
        requireApproval: true,
        defaultRole: "rep",
        settings,
      },
      source: "claude",
    };
  } catch (err) {
    console.error("[org-builder] Claude failed — using heuristic:", err);
    return { blueprint: base, source: "heuristic" };
  }
}
