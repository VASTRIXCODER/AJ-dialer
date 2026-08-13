import { formatFieldValue } from "@/lib/leads/field-schema";
import type { CallOutcome, Lead, MetricSummary } from "@/lib/types";
import { readCall } from "./appointment";
import {
  defaultAIContext,
  leadSchemaEntries,
  type LeadFieldEntry,
  type OrgAIContext,
  qualifyingQuestion,
  spokenFieldLabel,
} from "./org-context";
import type {
  CallCopilot,
  CallSummary,
  ConversationAnalysis,
  ExecutiveReport,
  LeadBriefing,
  SemanticSearch,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic intelligence simulators.
//
// These run when Claude isn't configured (or a call fails). They derive
// plausible, internally-consistent intelligence from the real lead/rep/metric
// data so demo mode feels alive rather than empty — the same philosophy as the
// dialer's Twilio simulation.
//
// Vertical-aware: every simulator takes the org's AI context (optional — a
// missing context falls back to the historical solar default and must never
// crash). Copy banks are keyed per template FAMILY: solar keeps its original
// copy verbatim; insurance/finance, real-estate, and recruiting/education get
// their own variants; everything else reads neutral. Field references come
// from the org's schema (labels + typed values), never hardcoded solar names.
// ─────────────────────────────────────────────────────────────────────────────

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

const firstName = (l: Lead) => l.firstName;

// ── Template families & copy banks ───────────────────────────────────────────

type TemplateFamily = "solar" | "neutral" | "insurance" | "real_estate" | "recruiting";

function familyOf(ctx: OrgAIContext): TemplateFamily {
  switch (ctx.template) {
    case "solar":
      return "solar";
    case "insurance":
    case "finance":
      return "insurance";
    case "real_estate":
      return "real_estate";
    case "recruiting":
    case "education":
      return "recruiting";
    default:
      return "neutral";
  }
}

/** The family for the non-solar code paths (solar branched off earlier). */
function nonSolarFamily(ctx: OrgAIContext): Exclude<TemplateFamily, "solar"> {
  const f = familyOf(ctx);
  return f === "solar" ? "neutral" : f;
}

const OBJECTION_BANK: Record<TemplateFamily, string[]> = {
  solar: [
    "“I’m already locked into my solar contract.”",
    "“Now isn’t a good time to talk.”",
    "“I don’t think I’m overpaying.”",
    "“I need to check with my spouse.”",
    "“I’ve been burned by solar sales before.”",
    "“Just send me something by email.”",
  ],
  neutral: [
    "“I’m already under contract.”",
    "“Now isn’t a good time to talk.”",
    "“I’m not sure this is for me.”",
    "“I need to check with my spouse.”",
    "“I’ve been burned by cold calls before.”",
    "“Just send me something by email.”",
  ],
  insurance: [
    "“I’m happy with my current provider.”",
    "“My renewal isn’t due for months.”",
    "“Switching sounds like a hassle.”",
    "“I need to compare a few quotes first.”",
    "“My last claims experience was painful.”",
    "“Just email me the quote.”",
  ],
  real_estate: [
    "“We’re not ready to move yet.”",
    "“The market doesn’t feel right.”",
    "“We already have an agent.”",
    "“I need to talk it over with my family.”",
    "“What would our place even go for?”",
    "“Just send me the comps by email.”",
  ],
  recruiting: [
    "“I’m happy where I am right now.”",
    "“I’m not actively looking.”",
    "“What does it actually pay?”",
    "“I couldn’t start for a while.”",
    "“Recruiters call me all the time.”",
    "“Just email me the details.”",
  ],
};

const PAIN_BANK: Record<Exclude<TemplateFamily, "solar">, string[]> = {
  neutral: [
    "Paying more than expected for the current setup",
    "Unsure they're getting what they pay for",
    "No time to compare alternatives",
    "A previous vendor over-promised and under-delivered",
  ],
  insurance: [
    "Premium has crept up at every renewal",
    "Not sure what the policy actually covers",
    "Filing the last claim was painful",
    "Paying for coverage they may not need",
  ],
  real_estate: [
    "Outgrowing the current home",
    "Unsure what the property is worth today",
    "Worried about timing the market",
    "Carrying costs higher than expected",
  ],
  recruiting: [
    "Feeling capped in the current role",
    "Compensation below market for the skill set",
    "No growth path where they are",
    "Long commute or rigid schedule",
  ],
};

const NEXT_QUESTION_BANK: Record<TemplateFamily, string[]> = {
  solar: [
    "What does a typical month on your utility bill look like now?",
    "Has anything changed recently — new appliances, EV, or more people home?",
    "Roughly what are you paying on the solar side each month?",
  ],
  neutral: [
    "What does your current setup look like month to month?",
    "Has anything changed recently that I should know about?",
    "What would make a switch worth it for you?",
  ],
  insurance: [
    "When does your current policy come up for renewal?",
    "Has anything changed since the policy was written — home, cars, drivers?",
    "Roughly what are you paying in premium right now?",
  ],
  real_estate: [
    "What's your ideal timeline if the numbers made sense?",
    "Have you had the home valued recently?",
    "What would the next place need to have?",
  ],
  recruiting: [
    "What would a move need to offer to be worth a conversation?",
    "Where are you at on compensation today, roughly?",
    "How soon could you realistically start something new?",
  ],
};

const OPENING_LINE: Record<Exclude<TemplateFamily, "solar">, (first: string) => string> = {
  neutral: (f) =>
    `Hi ${f}, this is a quick courtesy call about your account — we’re making sure people aren’t overpaying. Do you have 30 seconds?`,
  insurance: (f) =>
    `Hi ${f}, quick courtesy call about your coverage — we’re helping folks make sure they’re not overpaying at renewal. Do you have 30 seconds?`,
  real_estate: (f) =>
    `Hi ${f}, quick call about your property — the market’s moved and it may be worth more than you think. Do you have 30 seconds?`,
  recruiting: (f) =>
    `Hi ${f}, I’m reaching out about an opportunity that lines up with your background — do you have 30 seconds?`,
};

/** Schema fields worth chasing on a call, in schema order. */
function qualifyFields(ctx: OrgAIContext) {
  return ctx.fields.filter((f) => f.showInQualify);
}

/** The qualify-schema fields this lead has no value for yet (labels). */
function missingQualifyEntries(lead: Lead, ctx: OrgAIContext): LeadFieldEntry[] {
  const qualify = new Set(qualifyFields(ctx).map((f) => f.key));
  return leadSchemaEntries(lead, ctx).filter((e) => qualify.has(e.key) && e.value == null);
}

/** Sum of the lead's currency-typed schema values (0 when none). */
function currencyTotal(lead: Lead, ctx: OrgAIContext): number {
  return leadSchemaEntries(lead, ctx).reduce(
    (sum, e) => (e.type === "currency" && typeof e.value === "number" ? sum + e.value : sum),
    0,
  );
}

export function simulateBriefing(lead: Lead, ctx?: OrgAIContext): LeadBriefing {
  const c = ctx ?? defaultAIContext(true);
  const seed = hash(lead.id);
  if (c.isSolar) return solarBriefing(lead, seed);

  const family = nonSolarFamily(c);
  const entries = leadSchemaEntries(lead, c);
  const known = entries.filter((e) => e.value != null && e.value !== false);
  const total = currencyTotal(lead, c);
  const base = lead.aiScore ?? clamp(40 + total / 5 + (seed % 25));

  const flags = entries
    .filter((e) => e.type === "boolean" && e.value === true)
    .map((e) => spokenFieldLabel(e.label).toLowerCase());
  const flagText = flags.length ? ` They have ${flags.slice(0, 2).join(" and ")} on file.` : "";

  const factLines = known
    .filter((e) => e.type !== "boolean")
    .slice(0, 3)
    .map((e) => `${spokenFieldLabel(e.label)} ${formatFieldValue(e.value, e.type)}`);
  const facts = factLines.length ? ` On file: ${factLines.join(", ")}.` : "";

  const missing = missingQualifyEntries(lead, c);
  const chase = missing.length
    ? ` Confirm ${missing
        .slice(0, 2)
        .map((e) => spokenFieldLabel(e.label).toLowerCase())
        .join(" and ")} on the call.`
    : "";

  const personalities = [
    "Analytical & detail-driven",
    "Busy & decisive",
    "Skeptical but fair",
    "Relationship-oriented",
    "Cost-conscious pragmatist",
  ];
  const styles = [
    "Prefers concise, numbers-first explanations",
    "Responds to warmth and reassurance",
    "Wants proof and specifics before committing",
    "Appreciates a relaxed, conversational pace",
  ];
  const objectionBank = OBJECTION_BANK[family];
  const painBank = [
    ...(total > 0 ? [`Currently at ~$${total}/mo — feels higher than it should be`] : []),
    ...PAIN_BANK[family],
  ];

  const apptProb = clamp(base * 0.7 + (lead.status === "qualified" ? 18 : 0));
  const value =
    total > 0
      ? Math.round((total * 12 * 0.15 + 1200) / 50) * 50
      : 1500 + (seed % 20) * 50;

  return {
    summary:
      `${lead.firstName} ${lead.lastName} in ${lead.city}, ${lead.state} is a ` +
      `${lead.status === "new" ? "fresh" : lead.status} ${c.leadNoun}.${facts}${flagText}${chase}` +
      (total > 0
        ? ` A ~$${total}/mo spend is a strong signal this is worth a no-cost review.`
        : ` Worth a qualification pass to fill in the profile.`),
    priorityScore: clamp(base + (total > 350 ? 10 : 0)),
    appointmentProbability: apptProb,
    contactProbability: clamp(58 + (seed % 30)),
    qualificationProbability: clamp(base + 6),
    estimatedValue: value,
    personality: pick(personalities, seed),
    communicationStyle: pick(styles, seed >> 2),
    objections: [pick(objectionBank, seed), pick(objectionBank, seed >> 3)].filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
    painPoints: [pick(painBank, seed), pick(painBank, seed >> 4)].filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
    openingLine: OPENING_LINE[family](firstName(lead)),
    strategy:
      "Lead with curiosity, not a pitch. " +
      (missing.length
        ? `Confirm ${missing
            .slice(0, 2)
            .map((e) => spokenFieldLabel(e.label).toLowerCase())
            .join(" and ")}, then frame the appointment as helpful, not salesy.`
        : "Anchor on what's already on file, then frame the appointment as helpful, not salesy."),
    closingStrategy:
      "Offer two concrete windows and book the calendar before ending the call. " +
      "Reassure that it's free and no decision is required on the call.",
    bestCallback: pick(
      ["Today 5:30–6:30pm", "Tomorrow 11:00am–1:00pm", "Saturday 10:00am–12:00pm"],
      seed,
    ),
    confidence: clamp(70 + (seed % 22)),
  };
}

/** The original solar briefing, byte-for-byte the copy solar tenants know. */
function solarBriefing(lead: Lead, seed: number): LeadBriefing {
  const bill = lead.utilityBill ?? 0;
  const solar = lead.solarPayment ?? 0;
  // Within the solar vertical, phrasing still follows the lead's actual data —
  // a lead with no solar provider/payment reads as "pays the utility" rather
  // than inventing a solar plan for them. (Whether solar copy applies AT ALL is
  // decided by the org context now, not this lead-level heuristic.)
  const hasSolar = Boolean(lead.solarProvider || lead.solarPayment);
  const total = bill + solar;
  const base = lead.aiScore ?? clamp(40 + total / 5 + (seed % 25));

  const flags: string[] = [];
  if (lead.hasEV) flags.push("an EV adding overnight charging load");
  if (lead.hasPool) flags.push("a pool pump driving summer usage");
  if (lead.hasBattery) flags.push("a battery that should be offsetting more");
  const flagText = flags.length
    ? ` They have ${flags.slice(0, 2).join(" and ")}.`
    : "";

  const personalities = [
    "Analytical & detail-driven",
    "Busy & decisive",
    "Skeptical but fair",
    "Relationship-oriented",
    "Cost-conscious pragmatist",
  ];
  const styles = [
    "Prefers concise, numbers-first explanations",
    "Responds to warmth and reassurance",
    "Wants proof and specifics before committing",
    "Appreciates a relaxed, conversational pace",
  ];
  const objectionBank = [
    hasSolar ? "“I’m already locked into my solar contract.”" : "“I’m already under contract.”",
    "“Now isn’t a good time to talk.”",
    "“I don’t think I’m overpaying.”",
    "“I need to check with my spouse.”",
    hasSolar ? "“I’ve been burned by solar sales before.”" : "“I’ve been burned by cold calls before.”",
    "“Just send me something by email.”",
  ];
  const painBank = [
    hasSolar
      ? `Utility bill still ~$${bill || 210}/mo despite going solar`
      : `Utility bill still ~$${bill || 210}/mo`,
    "True-up surprise at the end of the year",
    "Paying two energy bills at once",
    "Usage climbing faster than expected",
    "Unsure the system is sized correctly",
  ];

  const apptProb = clamp(base * 0.7 + (lead.status === "qualified" ? 18 : 0));
  const value = Math.round((total * 12 * 0.18 + 1800) / 50) * 50;

  return {
    summary:
      `${lead.firstName} ${lead.lastName} in ${lead.city}, ${lead.state} ` +
      `${hasSolar ? `is on ${lead.solarProvider || "a solar plan"} yet still pays` : "pays"} ` +
      `${lead.utilityProvider || "the utility"} about $${bill || 200}/mo` +
      `${solar ? ` on top of a $${solar}/mo solar payment` : ""}.${flagText} ` +
      `Combined energy spend of ~$${total || 200}/mo is a strong overpayment signal worth a no-cost account review.`,
    priorityScore: clamp(base + (total > 350 ? 10 : 0)),
    appointmentProbability: apptProb,
    contactProbability: clamp(58 + (seed % 30)),
    qualificationProbability: clamp(base + 6),
    estimatedValue: value,
    personality: pick(personalities, seed),
    communicationStyle: pick(styles, seed >> 2),
    objections: [pick(objectionBank, seed), pick(objectionBank, seed >> 3)].filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
    painPoints: [pick(painBank, seed), pick(painBank, seed >> 4)].filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
    openingLine:
      `Hi ${firstName(lead)}, this is a quick courtesy call about your ${lead.utilityProvider || "utility"} ` +
      `account — we’re helping ${hasSolar ? "homeowners with solar" : "people"} make sure they’re not overpaying. Do you have 30 seconds?`,
    strategy:
      `Lead with curiosity, not a pitch. Confirm the current utility bill${hasSolar ? " and solar payment" : ""}, ` +
      "anchor on the monthly number, then frame the account review as protective, not salesy.",
    closingStrategy:
      "Offer two concrete review windows and book the calendar before ending the call. " +
      "Reassure that the review is free and no decision is required on the call.",
    bestCallback: pick(
      ["Today 5:30–6:30pm", "Tomorrow 11:00am–1:00pm", "Saturday 10:00am–12:00pm"],
      seed,
    ),
    confidence: clamp(70 + (seed % 22)),
  };
}

const RECENT_CHANGE_PROBE: Record<TemplateFamily, string> = {
  solar: "Any recent lifestyle or usage changes",
  neutral: "Any recent changes worth noting",
  insurance: "Any coverage or life changes since the policy was written",
  real_estate: "Timeline and motivation to move",
  recruiting: "Current compensation and notice period",
};

const ENGAGED_SIGNAL: Record<TemplateFamily, string> = {
  solar: "Mentioned high summer bills",
  neutral: "Asked about pricing",
  insurance: "Asked what a better premium would look like",
  real_estate: "Curious what the home would list for",
  recruiting: "Open to hearing the range",
};

export function simulateCopilot(lead: Lead, ctx?: OrgAIContext): CallCopilot {
  const c = ctx ?? defaultAIContext(true);
  const family = familyOf(c);
  const seed = hash(lead.id + "copilot");

  const signals: CallCopilot["signals"] = [
    { label: "Engaged — asking questions", tone: "positive" },
    { label: ENGAGED_SIGNAL[family], tone: "positive" },
  ];
  if (seed % 3 === 0) signals.push({ label: "Some hesitation on timing", tone: "neutral" });
  const flagged = leadSchemaEntries(lead, c).find(
    (e) => e.type === "boolean" && e.value === true,
  );
  if (flagged) {
    signals.push({ label: `${spokenFieldLabel(flagged.label)} raised`, tone: "positive" });
  }

  const missingEntries = missingQualifyEntries(lead, c);
  const missing = [
    ...missingEntries.slice(0, 2).map((e) => spokenFieldLabel(e.label)),
    RECENT_CHANGE_PROBE[family],
  ];

  // The single next best question: chase the first unfilled schema field the
  // org actually qualifies on; fall back to the vertical's discovery bank.
  const fieldDef =
    missingEntries.length > 0
      ? qualifyFields(c).find((f) => f.key === missingEntries[0].key)
      : undefined;
  const nextQuestion = fieldDef
    ? qualifyingQuestion(fieldDef)
    : pick(NEXT_QUESTION_BANK[family], seed);

  return {
    stage: "Discovery → Qualification",
    nextQuestion,
    signals,
    objectionHandler:
      "If they say it’s a bad time: “Totally understand — this is exactly why I’ll keep it to 30 seconds. " +
      "Most folks are surprised by what the review uncovers.”",
    missingInfo: missing,
    coachingTip: pick(
      [
        "You’re talking ~60% of the time — ask one open question and let them run.",
        "Great rapport. Lock a specific appointment slot before they cool off.",
        "Slow down after the price anchor — give them a beat to react.",
      ],
      seed,
    ),
  };
}

export function simulateSummary(
  lead: Lead,
  outcome?: CallOutcome,
  ctx?: OrgAIContext,
): CallSummary {
  const c = ctx ?? defaultAIContext(true);
  const seed = hash(lead.id + (outcome ?? ""));
  const recommended: CallOutcome =
    outcome ??
    pick<CallOutcome>(["appointment_booked", "callback_scheduled", "qualified"], seed);

  if (c.isSolar) {
    const bill = lead.utilityBill ?? 200;
    const solar = lead.solarPayment ?? 0;
    return {
      executiveSummary:
        `${lead.firstName} pays ~$${bill + solar}/mo combined and shows a clear overpayment pattern. ` +
        `${recommended === "appointment_booked" ? "Booked an account review." : "Warm — strong follow-up opportunity."}`,
      detailedSummary:
        `Confirmed ${lead.utilityProvider || "utility"} bill near $${bill}/mo` +
        `${solar ? ` alongside a $${solar}/mo solar payment` : ""}. ` +
        `${lead.hasEV ? "EV charging is increasing overnight load. " : ""}` +
        `${lead.hasPool ? "Pool pump contributes to summer spikes. " : ""}` +
        "Homeowner was receptive to a no-cost review and understood the combined-cost framing.",
      qualificationSummary:
        `Utility: $${bill}/mo · Solar: $${solar || "n/a"}/mo · ` +
        `EV: ${lead.hasEV ? "yes" : "no"} · Pool: ${lead.hasPool ? "yes" : "no"} · Battery: ${lead.hasBattery ? "yes" : "no"}.`,
      painPoints: [
        "Combined energy spend higher than expected",
        lead.hasEV ? "Added EV load not reflected in plan" : "Year-end true-up uncertainty",
      ],
      actionItems: [
        "Send confirmation with the review window",
        "Attach the last 12 months of usage if available",
      ],
      followUps: [
        recommended === "callback_scheduled"
          ? "Call back to confirm spouse availability"
          : "Reminder 24h before the review",
      ],
      riskFactors: [
        seed % 2 === 0 ? "Spouse not on the call — decision may slip" : "Existing contract may limit options",
      ],
      opportunity:
        `Est. ${Math.round((bill + solar) * 12 * 0.18)} in annual savings potential — prioritize for senior AM.`,
      recommendedOutcome: recommended,
      confidence: clamp(72 + (seed % 20)),
    };
  }

  const family = nonSolarFamily(c);
  const total = currencyTotal(lead, c);
  // The qualification line reads the org's OWN qualify schema — label by label.
  const qualLine = qualifyFields(c)
    .map((def) => {
      const entry = leadSchemaEntries(lead, c).find((e) => e.key === def.key);
      const v = entry?.value;
      return `${spokenFieldLabel(def.label)}: ${v == null ? "n/a" : formatFieldValue(v, def.type)}`;
    })
    .slice(0, 6)
    .join(" · ");
  const confirmed = leadSchemaEntries(lead, c)
    .filter((e) => e.value != null && e.value !== false && e.type !== "boolean")
    .slice(0, 3)
    .map((e) => `${spokenFieldLabel(e.label).toLowerCase()} at ${formatFieldValue(e.value, e.type)}`);

  return {
    executiveSummary:
      `${lead.firstName} is a ${lead.status === "new" ? "fresh" : lead.status} ${c.leadNoun}` +
      `${total ? ` at ~$${total}/mo` : ""}. ` +
      `${recommended === "appointment_booked" ? "Booked an appointment." : "Warm — strong follow-up opportunity."}`,
    detailedSummary:
      (confirmed.length
        ? `Confirmed ${confirmed.join(", ")}. `
        : "Walked the qualifying questions and captured the current picture. ") +
      `The ${c.leadNoun} was receptive to a no-obligation follow-up and understood the value framing.`,
    qualificationSummary: qualLine || `Qualification captured for this ${c.leadNoun}.`,
    painPoints: [pick(PAIN_BANK[family], seed), pick(PAIN_BANK[family], seed >> 3)].filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
    actionItems: [
      "Send confirmation with the agreed window",
      "Attach anything they should review beforehand",
    ],
    followUps: [
      recommended === "callback_scheduled"
        ? "Call back at the requested time"
        : "Reminder 24h before the appointment",
    ],
    riskFactors: [
      seed % 2 === 0
        ? "Decision-maker not on the call — timing may slip"
        : "Existing commitment may limit options",
    ],
    opportunity: total
      ? `Est. $${Math.round(total * 12 * 0.15)} in annual value at stake — prioritize for a senior closer.`
      : `Engaged ${c.leadNoun} — prioritize a timely follow-up while it's warm.`,
    recommendedOutcome: recommended,
    confidence: clamp(72 + (seed % 20)),
  };
}

export function simulateReport(metrics: MetricSummary, ctx?: OrgAIContext): ExecutiveReport {
  const c = ctx ?? defaultAIContext(true);
  const conn = Math.round(metrics.connectRate);
  const appt = Math.round(metrics.appointmentRate);

  if (c.isSolar) {
    return {
      headline: `${metrics.callsToday.toLocaleString()} dials today at a ${conn}% connect rate`,
      narrative:
        `The floor placed ${metrics.totalCalls.toLocaleString()} calls with a ${conn}% connect rate and a ` +
        `${appt}% appointment rate, booking ${metrics.appointmentsBooked} reviews. Average energy spend across ` +
        `qualified homeowners is $${metrics.avgTotalEnergyCost}/mo, which keeps the overpayment thesis strong. ` +
        `No-shows (${metrics.noShows}) and reschedules (${metrics.reschedules}) are the main leakage points downstream.`,
      trends: [
        `Connect rate holding at ${conn}% — healthy for outbound solar`,
        `Battery ownership at ${metrics.batteryOwnership}% signals a maturing base`,
        `EV ownership ${metrics.evOwnership}% correlates with higher bills`,
      ],
      risks: [
        `${metrics.noShows} no-shows are eroding booked-to-held conversion`,
        `No-answer rate of ${Math.round(metrics.noAnswerRate)}% suggests list fatigue on older cohorts`,
      ],
      opportunities: [
        "Prioritize homeowners over $300/mo combined spend for senior AMs",
        "Add a 24h reminder to recover no-show leakage",
        "Re-time callbacks to the early-evening window that connects best",
      ],
      recommendations: [
        {
          title: "Tighten the booked-to-held funnel",
          detail: `With ${metrics.appointmentsBooked} booked and ${metrics.noShows} no-shows, an automated reminder + confirmation call could recover several reviews per day.`,
          priority: "high",
        },
        {
          title: "Concentrate on high-bill cohorts",
          detail: "Route homeowners above the average combined spend to your strongest closers first.",
          priority: "medium",
        },
        {
          title: "Refresh fatigued segments",
          detail: "Rotate in newer leads where no-answer rates are climbing to protect connect rate.",
          priority: "low",
        },
      ],
    };
  }

  const plural = c.leadNounPlural;
  return {
    headline: `${metrics.callsToday.toLocaleString()} dials today at a ${conn}% connect rate`,
    narrative:
      `The floor placed ${metrics.totalCalls.toLocaleString()} calls with a ${conn}% connect rate and a ` +
      `${appt}% appointment rate, booking ${metrics.appointmentsBooked} appointments with ${plural}. ` +
      `No-shows (${metrics.noShows}) and reschedules (${metrics.reschedules}) are the main leakage points downstream.`,
    trends: [
      `Connect rate holding at ${conn}% — healthy for outbound`,
      `Appointment rate at ${appt}% of connects`,
      `Callback rate at ${Math.round(metrics.callbackRate)}% keeps the pipeline warm`,
    ],
    risks: [
      `${metrics.noShows} no-shows are eroding booked-to-held conversion`,
      `No-answer rate of ${Math.round(metrics.noAnswerRate)}% suggests list fatigue on older cohorts`,
    ],
    opportunities: [
      `Prioritize your highest-scoring ${plural} for the strongest closers`,
      "Add a 24h reminder to recover no-show leakage",
      "Re-time callbacks to the early-evening window that connects best",
    ],
    recommendations: [
      {
        title: "Tighten the booked-to-held funnel",
        detail: `With ${metrics.appointmentsBooked} booked and ${metrics.noShows} no-shows, an automated reminder + confirmation call could recover several appointments per day.`,
        priority: "high",
      },
      {
        title: "Concentrate on high-score cohorts",
        detail: `Route ${plural} with the highest AI scores to your strongest closers first.`,
        priority: "medium",
      },
      {
        title: "Refresh fatigued segments",
        detail: `Rotate in newer ${plural} where no-answer rates are climbing to protect connect rate.`,
        priority: "low",
      },
    ],
  };
}

export function simulateSearch(
  query: string,
  leads: Lead[],
  ctx?: OrgAIContext,
): SemanticSearch {
  const c = ctx ?? defaultAIContext(true);
  const q = query.toLowerCase();
  const num = q.match(/\$?\s*(\d{2,4})/);
  const threshold = num ? Number(num[1]) : null;

  // Solar keeps its colloquial synonyms ("electric vehicle" → EV, "storage" →
  // battery); every schema field also matches on its own label generically.
  const synonyms: Record<string, string[]> = c.isSolar
    ? {
        hasEV: ["ev", "electric vehicle", "tesla"],
        hasBattery: ["battery", "storage", "powerwall"],
        hasPool: ["pool"],
      }
    : {};

  const scored = leads
    .map((l) => {
      const entries = leadSchemaEntries(l, c);
      const reasons: string[] = [];
      let score = 0;
      let thresholdUsed = false;

      for (const e of entries) {
        const label = spokenFieldLabel(e.label).toLowerCase();
        const tokens = [label, ...(synonyms[e.key] ?? [])].filter(
          (t) => t.length >= 2,
        );
        const mentioned = tokens.some((t) => q.includes(t));
        if (e.type === "boolean") {
          if (mentioned && e.value === true) {
            score += 3;
            reasons.push(`${spokenFieldLabel(e.label)}: yes`);
          }
        } else if (e.type === "currency" || e.type === "number") {
          if (
            mentioned &&
            threshold != null &&
            typeof e.value === "number" &&
            e.value >= threshold
          ) {
            score += 3;
            thresholdUsed = true;
            reasons.push(`${spokenFieldLabel(e.label)} ~${formatFieldValue(e.value, e.type)}`);
          }
        } else if (typeof e.value === "string" && e.value.length >= 2) {
          if (mentioned || q.includes(e.value.toLowerCase())) {
            score += 2;
            reasons.push(`${spokenFieldLabel(e.label)}: ${e.value}`);
          }
        }
      }

      // A bare "$300" with no field named still means "a monthly amount":
      // apply it to the first currency field the schema tracks.
      if (threshold != null && !thresholdUsed) {
        const firstCurrency = entries.find(
          (e) => e.type === "currency" && typeof e.value === "number",
        );
        if (firstCurrency && (firstCurrency.value as number) >= threshold) {
          score += 2;
          reasons.push(
            `${spokenFieldLabel(firstCurrency.label)} ~${formatFieldValue(firstCurrency.value, "currency")}`,
          );
        }
      }

      if ((q.includes("appointment") || q.includes("booked")) && l.status === "appointment") {
        score += 3;
        reasons.push("has an appointment");
      }
      if (q.includes("callback") && l.status === "callback") {
        score += 3;
        reasons.push("callback scheduled");
      }
      if ((q.includes("qualified") || q.includes("warm")) && l.status === "qualified") {
        score += 2;
        reasons.push("qualified lead");
      }
      const total = currencyTotal(l, c);
      if (
        (q.includes("frustrat") || q.includes("overpay") || q.includes("high bill")) &&
        total >= 300
      ) {
        score += 2;
        reasons.push(`high combined spend $${total}/mo`);
      }
      if (q.includes(l.city.toLowerCase()) || q.includes(l.state.toLowerCase())) {
        score += 2;
        reasons.push(`${l.city}, ${l.state}`);
      }
      return { l, score, reason: reasons.join(" · ") };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // Fallback: light name / city contains match so search never feels dead.
  const matches = scored.length
    ? scored
    : leads
        .filter(
          (l) =>
            `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
            l.city.toLowerCase().includes(q),
        )
        .slice(0, 6)
        .map((l) => ({ l, score: 1, reason: `${l.city}, ${l.state}` }));

  return {
    interpretation: `Showing ${c.leadNounPlural} matching “${query.trim()}”.`,
    matches: matches.map((s) => ({
      id: s.l.id,
      reason: s.reason || `${s.l.city}, ${s.l.state}`,
    })),
  };
}

/** Pull a plausible monthly dollar amount near billing language from a transcript. */
function extractBill(t: string): number | null {
  // Prefer an explicit "$NNN" or "NNN dollars/a month" over any stray number.
  const dollar = t.match(/\$\s?(\d{2,4})/);
  if (dollar) return Number(dollar[1]);
  const perMonth = t.match(
    /(\d{2,4})\s*(?:dollars|bucks)?\s*(?:a|per)\s*month|(\d{2,4})\s*\/\s*mo/,
  );
  if (perMonth) return Number(perMonth[1] ?? perMonth[2]);
  return null;
}

/**
 * Deterministic read of a completed AI conversation when Claude isn't available.
 * This only runs for calls that actually CONNECTED, so the outcome is always a
 * connected one. Unlike the old version, it reads the real transcript: it detects
 * the disposition from what was actually said and resolves the appointment time
 * the customer agreed to (anchored to today's date + their timezone) instead of
 * picking a random canned slot.
 *
 * Solar-template orgs get the solar qualification extraction (the fields the
 * finalize pipeline writes back onto the lead); everyone else gets no
 * qualification object at all — see analyzeConversation.
 */
export function simulateConversationAnalysis(input: {
  transcript?: string;
  lead?: Lead | null;
  now?: Date;
  tz?: string;
  ctx?: OrgAIContext;
}): ConversationAnalysis {
  const c = input.ctx ?? defaultAIContext(true);
  const lead = input.lead ?? null;
  const raw = input.transcript ?? "";
  // Read disposition from the CUSTOMER's words only (the agent's own "perfect" /
  // "you're all set" must never be read as the customer declining or agreeing).
  const read = readCall(raw, input.now ?? new Date(), input.tz);
  // Qualification still scans the whole transcript (facts are stated by both).
  const customerText = raw.toLowerCase();
  const seed = hash((lead?.id ?? "conv") + customerText.slice(0, 48));

  const { outcome, sentiment, booked, appointment: slot } = read;

  const who = lead?.firstName || `The ${c.leadNoun}`;
  const wrap = booked
    ? `Booked a no-cost account review for ${slot.when}.`
    : outcome === "callback_scheduled"
      ? "Asked to be called back — follow-up scheduled."
      : outcome === "not_interested"
        ? "Not interested at this time."
        : outcome === "do_not_call"
          ? "Asked to be placed on the do-not-call list."
          : "Engaged and qualified — follow-up recommended.";

  const base = {
    outcome,
    sentiment,
    appointment: {
      requested: booked,
      when: booked ? slot.when : "",
      notes: booked ? slot.notes : "",
    },
    followUps: booked
      ? ["Send calendar invite + confirmation", "Reminder call ~1h before"]
      : outcome === "callback_scheduled"
        ? ["Call back at the requested time"]
        : ["Re-attempt during the early-evening window"],
    confidence: clamp(70 + (seed % 22)),
  };

  if (c.isSolar) {
    const bill = lead?.utilityBill ?? extractBill(customerText) ?? 0;
    const solar = lead?.solarPayment ?? 0;
    return {
      ...base,
      summary: `${who} discussed a combined ~$${bill + solar}/mo energy spend. ${wrap}`,
      detailedSummary: raw
        ? raw.slice(0, 320)
        : "The AI agent confirmed the utility bill and solar payment, checked for EV / pool / battery, and captured any recent usage changes per the solar resolution script.",
      qualification: {
        utilityBill: bill || null,
        solarPayment: solar || null,
        hasEV: lead?.hasEV ?? /\bev\b|electric vehicle|tesla/.test(customerText),
        hasPool: lead?.hasPool ?? /pool/.test(customerText),
        hasBattery: lead?.hasBattery ?? /battery|powerwall|storage/.test(customerText),
      },
    };
  }

  return {
    ...base,
    summary: `${who} spoke with the AI agent. ${wrap}`,
    detailedSummary: raw
      ? raw.slice(0, 320)
      : `The AI agent confirmed the ${c.leadNoun}'s details, walked the qualifying questions, and captured any changes since last contact.`,
    // No solar qualification for non-solar orgs — nothing solar is written back.
  };
}
