import type { CallOutcome, Lead, MetricSummary } from "@/lib/types";
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

export function simulateBriefing(lead: Lead): LeadBriefing {
  const seed = hash(lead.id);
  const bill = lead.utilityBill ?? 0;
  const solar = lead.solarPayment ?? 0;
  const total = bill + solar;
  const base = lead.aiScore ?? clamp(40 + (total / 5) + (seed % 25));

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
    "“I’m already locked into my solar contract.”",
    "“Now isn’t a good time to talk.”",
    "“I don’t think I’m overpaying.”",
    "“I need to check with my spouse.”",
    "“I’ve been burned by solar sales before.”",
    "“Just send me something by email.”",
  ];
  const painBank = [
    `Utility bill still ~$${bill || 210}/mo despite going solar`,
    "True-up surprise at the end of the year",
    "Paying two energy bills at once",
    "Usage climbing faster than expected",
    "Unsure the system is sized correctly",
  ];

  const apptProb = clamp(base * 0.7 + (lead.status === "qualified" ? 18 : 0));
  const value = Math.round((total * 12 * 0.18 + 1800) / 50) * 50;

  return {
    summary:
      `${lead.firstName} ${lead.lastName} in ${lead.city}, ${lead.state} is on ${lead.solarProvider || "a solar plan"} ` +
      `yet still pays ${lead.utilityProvider || "the utility"} about $${bill || 200}/mo` +
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
      `account — we’re helping homeowners with solar make sure they’re not overpaying. Do you have 30 seconds?`,
    strategy:
      "Lead with curiosity, not a pitch. Confirm the current utility bill and solar payment, " +
      "anchor on the combined monthly number, then frame the account review as protective, not salesy.",
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

export function simulateCopilot(lead: Lead): CallCopilot {
  const seed = hash(lead.id + "copilot");
  const signals: CallCopilot["signals"] = [
    { label: "Engaged — asking questions", tone: "positive" },
    { label: "Mentioned high summer bills", tone: "positive" },
  ];
  if (seed % 3 === 0) signals.push({ label: "Some hesitation on timing", tone: "neutral" });
  if (lead.hasEV) signals.push({ label: "EV charging raised", tone: "positive" });

  const missing = [
    !lead.utilityBill && "Current monthly utility bill",
    !lead.solarPayment && "Solar loan / lease payment",
    "Any recent lifestyle or usage changes",
  ].filter(Boolean) as string[];

  return {
    stage: "Discovery → Qualification",
    nextQuestion: pick(
      [
        "What does a typical month on your utility bill look like now?",
        "Has anything changed recently — new appliances, EV, or more people home?",
        "Roughly what are you paying on the solar side each month?",
      ],
      seed,
    ),
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

export function simulateSummary(lead: Lead, outcome?: CallOutcome): CallSummary {
  const seed = hash(lead.id + (outcome ?? ""));
  const bill = lead.utilityBill ?? 200;
  const solar = lead.solarPayment ?? 0;
  const recommended: CallOutcome =
    outcome ??
    pick<CallOutcome>(
      ["appointment_booked", "callback_scheduled", "qualified"],
      seed,
    );
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

export function simulateReport(metrics: MetricSummary): ExecutiveReport {
  const conn = Math.round(metrics.connectRate);
  const appt = Math.round(metrics.appointmentRate);
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

export function simulateSearch(query: string, leads: Lead[]): SemanticSearch {
  const q = query.toLowerCase();
  const num = q.match(/\$?\s*(\d{2,4})/);
  const threshold = num ? Number(num[1]) : null;
  const wantOver = /over|above|more than|>|high/.test(q);

  const scored = leads
    .map((l) => {
      const total = (l.utilityBill ?? 0) + (l.solarPayment ?? 0);
      const reasons: string[] = [];
      let score = 0;
      if ((q.includes("ev") || q.includes("electric vehicle")) && l.hasEV) {
        score += 3;
        reasons.push("owns an EV");
      }
      if ((q.includes("battery") || q.includes("storage")) && l.hasBattery) {
        score += 3;
        reasons.push("has battery storage");
      }
      if (q.includes("pool") && l.hasPool) {
        score += 3;
        reasons.push("has a pool");
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
      if (threshold && (l.utilityBill ?? 0) >= threshold && (wantOver || true)) {
        score += 2;
        reasons.push(`utility bill ~$${l.utilityBill}/mo`);
      }
      if ((q.includes("frustrat") || q.includes("overpay") || q.includes("high bill")) && total >= 300) {
        score += 2;
        reasons.push(`high combined spend $${total}/mo`);
      }
      if (q.includes(l.city.toLowerCase()) || q.includes(l.state.toLowerCase())) {
        score += 2;
        reasons.push(`${l.city}, ${l.state}`);
      }
      if (l.utilityProvider && q.includes(l.utilityProvider.toLowerCase())) {
        score += 2;
        reasons.push(l.utilityProvider);
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
    interpretation: `Showing homeowners matching “${query.trim()}”.`,
    matches: matches.map((s) => ({
      id: s.l.id,
      reason: s.reason || `${s.l.city}, ${s.l.state}`,
    })),
  };
}

export function simulateConversationAnalysis(input: {
  transcript?: string;
  lead?: Lead | null;
}): ConversationAnalysis {
  const lead = input.lead ?? null;
  const t = (input.transcript ?? "").toLowerCase();
  const seed = hash((lead?.id ?? "conv") + t.slice(0, 48));
  const billMatch = t.match(/\$?\s?(\d{2,4})/);
  const bill = lead?.utilityBill ?? (billMatch ? Number(billMatch[1]) : 0);
  const solar = lead?.solarPayment ?? 0;

  const wantsAppt =
    /appointment|book|schedule|review|works for me|sounds good|set.{0,6}up/.test(t) ||
    (!t && seed % 2 === 0);
  const sentiment: ConversationAnalysis["sentiment"] = /not interested|stop|remove|busy/.test(t)
    ? "negative"
    : /great|interested|sounds good|yes|perfect/.test(t) || wantsAppt
      ? "positive"
      : "neutral";
  const outcome: CallOutcome = wantsAppt
    ? "appointment_booked"
    : pick<CallOutcome>(["callback_scheduled", "qualified", "not_interested", "no_answer"], seed);

  return {
    summary: lead
      ? `${lead.firstName} discussed a combined ~$${bill + solar}/mo energy spend. ${
          wantsAppt ? "Booked a no-cost account review." : "Warm — follow-up recommended."
        }`
      : "The AI agent qualified the homeowner against the solar resolution script.",
    detailedSummary: input.transcript
      ? input.transcript.slice(0, 320)
      : "The AI agent confirmed the utility bill and solar payment, checked for EV / pool / battery, and captured any recent usage changes per the solar resolution script.",
    outcome,
    sentiment,
    qualification: {
      utilityBill: bill || null,
      solarPayment: solar || null,
      hasEV: lead?.hasEV ?? /\bev\b|electric vehicle|tesla/.test(t),
      hasPool: lead?.hasPool ?? /pool/.test(t),
      hasBattery: lead?.hasBattery ?? /battery|powerwall|storage/.test(t),
    },
    appointment: {
      requested: wantsAppt,
      when: wantsAppt ? pick(["Tomorrow 2:00pm", "Thursday 11:00am", "Saturday 10:00am"], seed) : "",
      notes: wantsAppt ? "Homeowner agreed to a no-cost account review." : "",
    },
    followUps: wantsAppt
      ? ["Send calendar invite + confirmation"]
      : ["Re-attempt during the early-evening window"],
    confidence: clamp(70 + (seed % 22)),
  };
}
