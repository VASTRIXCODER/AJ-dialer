import { describe, expect, it } from "vitest";
import {
  leadSchemaEntries,
  orgAIContext,
  qualifyingQuestion,
} from "@/lib/ai/org-context";
import {
  simulateBriefing,
  simulateConversationAnalysis,
  simulateCopilot,
  simulateReport,
  simulateSearch,
  simulateSummary,
} from "@/lib/ai/simulate";
import { agentVariablesForLead } from "@/lib/elevenlabs";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import { mergeSettings } from "@/lib/org/settings";
import { resolveAgentConfig } from "@/lib/ai/agent-prompt";
import type { Lead, MetricSummary } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// The org AI context + vertical-aware AI/demo surfaces (P6.AIADAPT).
// ─────────────────────────────────────────────────────────────────────────────

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    firstName: "Jordan",
    lastName: "Miles",
    phone: "+15551230001",
    address: "12 Oak St",
    city: "Fresno",
    state: "CA",
    zip: "93710",
    utilityProvider: "",
    solarProvider: "",
    status: "new",
    campaignId: "",
    hasEV: false,
    hasPool: false,
    hasBattery: false,
    multipleSystems: false,
    createdAt: new Date().toISOString(),
    timezone: "America/Los_Angeles",
    ...overrides,
  };
}

const CUSTOM_DEF: LeadFieldDef = {
  key: "policy_expiry",
  label: "Policy expiry",
  type: "date",
  source: "custom",
  showInTable: true,
  showInQualify: true,
};

const METRICS: MetricSummary = {
  totalCalls: 1200,
  callsToday: 140,
  connections: 300,
  conversations: 250,
  avgCallLenSec: 95,
  connectRate: 25,
  appointmentRate: 12,
  callbackRate: 8,
  noAnswerRate: 55,
  appointmentsBooked: 14,
  appointmentsCompleted: 9,
  noShows: 3,
  reschedules: 2,
  avgUtilityBill: 210,
  avgSolarPayment: 160,
  avgTotalEnergyCost: 370,
  evOwnership: 30,
  poolOwnership: 20,
  batteryOwnership: 10,
};

describe("orgAIContext", () => {
  it("defaults to the historical solar context when there is no org", () => {
    const ctx = orgAIContext(null);
    expect(ctx.isSolar).toBe(true);
    expect(ctx.template).toBe("solar");
    expect(ctx.leadNoun).toBe("homeowner");
    expect(ctx.fields.length).toBeGreaterThanOrEqual(8);
  });

  it("derives a non-solar context from the org's template", () => {
    const ctx = orgAIContext({ dialerTemplate: "insurance" });
    expect(ctx.isSolar).toBe(false);
    expect(ctx.leadNoun).toBe("policyholder");
  });

  it("honors an org's explicit lead noun over the template's", () => {
    const ctx = orgAIContext({
      dialerTemplate: "general",
      settings: { leadNoun: "member", leadNounPlural: "members" },
    });
    expect(ctx.leadNoun).toBe("member");
    expect(ctx.leadNounPlural).toBe("members");
  });

  it("includes org-saved custom field defs in the schema", () => {
    const ctx = orgAIContext({
      dialerTemplate: "insurance",
      settings: { leadFields: [CUSTOM_DEF] },
    });
    expect(ctx.fields.some((f) => f.key === "policy_expiry")).toBe(true);
  });
});

describe("leadSchemaEntries", () => {
  it("serializes schema fields with labels and surfaces unschema'd custom values", () => {
    const ctx = orgAIContext({
      dialerTemplate: "general",
      settings: { leadFields: [CUSTOM_DEF] },
    });
    const lead = makeLead({
      customFields: { policy_expiry: "2026-10-01", loan_balance: 12000 },
    });
    const entries = leadSchemaEntries(lead, ctx);
    const expiry = entries.find((e) => e.key === "policy_expiry");
    expect(expiry?.label).toBe("Policy expiry");
    expect(expiry?.value).toBe("2026-10-01");
    const stray = entries.find((e) => e.key === "loan_balance");
    expect(stray?.label).toBe("Loan Balance");
    expect(stray?.value).toBe(12000);
  });
});

describe("qualifyingQuestion", () => {
  it("phrases questions by field type", () => {
    expect(
      qualifyingQuestion({ ...CUSTOM_DEF, key: "premium", label: "Current premium ($/mo)", type: "currency" }),
    ).toBe("What does your current premium come to in a typical month?");
    expect(
      qualifyingQuestion({ ...CUSTOM_DEF, key: "has_ev", label: "EV", type: "boolean" }),
    ).toBe("Do you have an EV?");
  });
});

describe("demo simulators adapt to the org context and never crash without one", () => {
  const lead = makeLead();
  const insuranceCtx = orgAIContext({ dialerTemplate: "insurance" });

  it("simulateBriefing keeps solar copy for solar and drops it elsewhere", () => {
    const solar = simulateBriefing(makeLead({ utilityBill: 240, solarPayment: 150 }));
    expect(solar.summary.toLowerCase()).toContain("energy");
    const ins = simulateBriefing(lead, insuranceCtx);
    expect(ins.summary.toLowerCase()).not.toContain("solar");
    expect(ins.openingLine.toLowerCase()).not.toContain("solar");
    expect(ins.summary).toContain("policyholder");
  });

  it("simulateCopilot / simulateSummary / simulateReport run with and without ctx", () => {
    expect(simulateCopilot(lead).nextQuestion.length).toBeGreaterThan(0);
    expect(simulateCopilot(lead, insuranceCtx).missingInfo.length).toBeGreaterThan(0);
    expect(simulateSummary(lead).recommendedOutcome).toBeTruthy();
    const nonSolarSummary = simulateSummary(lead, "qualified", insuranceCtx);
    expect(nonSolarSummary.qualificationSummary.toLowerCase()).not.toContain("solar");
    expect(simulateReport(METRICS).narrative).toContain("energy");
    const nonSolarReport = simulateReport(METRICS, insuranceCtx);
    expect(nonSolarReport.narrative.toLowerCase()).not.toContain("energy");
    expect(nonSolarReport.narrative).toContain("policyholders");
  });

  it("simulateSearch scores schema fields generically and never dies on empty input", () => {
    expect(simulateSearch("anything", []).matches).toEqual([]);
    const withData = makeLead({ utilityBill: 350 });
    const res = simulateSearch("over $300", [withData]);
    expect(res.matches.length).toBe(1);
    const insurance = simulateSearch("warm", [makeLead({ status: "qualified" })], insuranceCtx);
    expect(insurance.interpretation).toContain("policyholders");
  });

  it("simulateConversationAnalysis extracts solar qualification ONLY for solar", () => {
    const transcript = "agent: hi\nuser: yes I pay $250 a month";
    const solar = simulateConversationAnalysis({ transcript, lead });
    expect(solar.qualification).toBeDefined();
    const generic = simulateConversationAnalysis({
      transcript,
      lead,
      ctx: insuranceCtx,
    });
    expect(generic.qualification).toBeUndefined();
    expect(generic.summary.toLowerCase()).not.toContain("energy");
  });
});

describe("agentVariablesForLead", () => {
  it("emits sanitized, capped custom_<key> variables", () => {
    const lead = makeLead({
      customFields: {
        "Policy Expiry ": "2026-10-01",
        loan_balance: 12000,
        long_note: "x".repeat(500),
      },
    });
    const vars = agentVariablesForLead(lead);
    expect(vars.custom_policy_expiry).toBe("2026-10-01");
    expect(vars.custom_loan_balance).toBe(12000);
    expect(String(vars.custom_long_note)).toHaveLength(200);
  });

  it("gates the Sunrun/solar_provider fallback to the solar template", () => {
    const lead = makeLead();
    expect(agentVariablesForLead(lead).company).toBe("Sunrun"); // legacy/demo
    expect(agentVariablesForLead(lead, { dialerTemplate: "solar" }).company).toBe("Sunrun");
    const ins = agentVariablesForLead(lead, { dialerTemplate: "insurance" });
    expect(ins.company).toBe("our team");
    expect(ins.solar_provider).toBe("our team"); // alias kept, never "Sunrun"
    expect(
      agentVariablesForLead(lead, { dialerTemplate: "insurance", company: "Acme Cover" }).company,
    ).toBe("Acme Cover");
  });

  it("never lets a custom field shadow a fixed variable", () => {
    const lead = makeLead({ customFields: { company: "Evil Co" } });
    const vars = agentVariablesForLead(lead, { company: "Real Co" });
    expect(vars.company).toBe("Real Co");
    expect(vars.custom_company).toBe("Evil Co");
  });
});

describe("voice-agent prompt schema injection", () => {
  const orgWithSchema = {
    name: "Shield Insurance",
    productName: "",
    dialerTemplate: "insurance",
    settings: mergeSettings({ leadFields: [CUSTOM_DEF] }),
  };

  it("genericPrompt asks the org's schema-driven qualifying questions", () => {
    const cfg = resolveAgentConfig(orgWithSchema);
    expect(cfg.systemPrompt).toContain("Qualifying questions");
    expect(cfg.systemPrompt).toContain("When is your policy expiry?");
  });

  it("injects the qualify section into org-custom prompts too", () => {
    const custom = {
      ...orgWithSchema,
      settings: mergeSettings({
        leadFields: [CUSTOM_DEF],
        ai: { systemPrompt: "You are Quinn. Do exactly as configured." },
      }),
    };
    const cfg = resolveAgentConfig(custom);
    expect(cfg.systemPrompt).toContain("You are Quinn.");
    expect(cfg.systemPrompt).toContain("When is your policy expiry?");
  });

  it("does not put solar-era default questions in a non-solar agent's mouth", () => {
    const bare = {
      name: "Shield Insurance",
      productName: "",
      dialerTemplate: "insurance",
      settings: mergeSettings({}),
    };
    const cfg = resolveAgentConfig(bare);
    expect(cfg.systemPrompt.toLowerCase()).not.toContain("solar payment");
  });
});
