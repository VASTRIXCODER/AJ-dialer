import { NextResponse } from "next/server";
import { chatComplete, isAIConfigured } from "@/lib/ai/claude";
import { type OrgAIContext, orgAIContext } from "@/lib/ai/org-context";
import { getUser } from "@/lib/auth";
import { getLeadStats } from "@/lib/db/leads";
import { getReportingData } from "@/lib/db/metrics";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

type ChatMsg = { role: "user" | "assistant"; content: string };

const SYSTEM = (ctx: string, ai: OrgAIContext) =>
  (ai.isSolar
    ? "You are the AI Command Center assistant for AIATWORK, a solar resolution " +
      "auto-dialer. Solar reps (and an AI voice agent) call homeowners who already " +
      "have solar but still overpay their utility, qualify them, and book no-cost " +
      "account reviews. "
    : "You are the AI Command Center assistant for AIATWORK, an outbound sales " +
      `auto-dialer. Reps (and an AI voice agent, where enabled) call ${ai.leadNounPlural}, qualify ` +
      "them, and book appointments — never assume or mention solar, utility bills, " +
      "or energy costs unless they're explicitly present in the data below. ") +
  // The nav names below are what a rep sees, so the assistant's instructions
  // have to use the same words or its "go to Leads" advice points at a tab
  // labelled "Candidates".
  `This workspace calls its contacts "${ai.leadNounPlural}". ` +
  "You help the user oversee the floor: brief them on " +
  "performance, suggest who to call, interpret reports, and explain how to use " +
  "any part of the app (Power Dialer with AI/manual dialing, Live Monitor, " +
  "Leads, Appointments, Callbacks, Reports, Leaderboard, Admin/User management). " +
  "Be concise, warm, and specific — use the user's REAL numbers below and never " +
  "invent data. Prefer short paragraphs and simple dashes for lists.\n\n" +
  `CURRENT FLOOR DATA (live): ${ctx}`;

/**
 * Build a compact, real data context for the assistant. Schema-aware: the
 * solar spend averages only ride along for solar-template orgs — every other
 * vertical's assistant sees vertical-neutral floor numbers.
 */
async function buildContext(ai: OrgAIContext) {
  const [report, leads] = await Promise.all([getReportingData(), getLeadStats()]);
  const m = report.metrics;
  return {
    metrics: {
      totalCalls: m.totalCalls,
      callsToday: m.callsToday,
      connectRate: `${m.connectRate}%`,
      appointmentsBooked: m.appointmentsBooked,
      ...(ai.isSolar
        ? { avgUtilityBill: m.avgUtilityBill, avgSolarPayment: m.avgSolarPayment }
        : {}),
    },
    leads: {
      total: leads.total,
      qualified: leads.qualified,
      appointments: leads.appointments,
      avgScore: leads.avgScore,
    },
    liveCalls: report.liveCalls.length,
    upcomingAppointments: report.appointments
      .filter((a) => a.status === "scheduled")
      .slice(0, 5)
      .map((a) => `${a.leadName} — ${a.whenLabel}`),
    recentOutcomes: report.recentCalls
      .slice(0, 6)
      .map((c) => `${c.leadName}: ${c.outcome ?? "—"}`),
  };
}

/** Deterministic, still-useful reply when Claude isn't configured. */
function demoReply(ctx: Awaited<ReturnType<typeof buildContext>>, last: string): string {
  const q = last.toLowerCase();
  const brief =
    `Here's your floor right now:\n` +
    `- ${ctx.metrics.callsToday} calls today (${ctx.metrics.totalCalls} all-time) at a ${ctx.metrics.connectRate} connect rate\n` +
    `- ${ctx.metrics.appointmentsBooked} appointments booked\n` +
    `- ${ctx.leads.total} leads (${ctx.leads.qualified} qualified, avg AI score ${ctx.leads.avgScore})\n` +
    `- ${ctx.liveCalls} live call${ctx.liveCalls === 1 ? "" : "s"} right now`;

  if (/lead|call first|who/.test(q))
    return `${brief}\n\nStart with your highest-AI-score leads in the Power Dialer queue — they're sorted for you. Use Browse leads to pick anyone specific, or dial a number directly with AI.`;
  if (/report|connect|rate|perform/.test(q))
    return `${brief}\n\nOpen Reports for the full breakdown — click any call to see its transcript, summary, booked appointment, and recording.`;
  if (/appointment|callback|book/.test(q))
    return `${brief}\n\nBooked reviews land in Appointments; callback-dispositioned calls land in Callbacks — both update automatically as calls complete.`;
  if (/how|use|start|dial/.test(q))
    return `To run the floor: open the Power Dialer, pick 1×/2×/3× lines, and press Start — calls default to the AI agent (flip to Manual for human dialing). Watch everything live in the Live Monitor.\n\n${brief}`;
  return `${brief}\n\nAsk me to brief you, suggest who to call, interpret your reports, or explain any tab. (Connect ANTHROPIC_API_KEY for full live answers.)`;
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ reply: "Sign in to use the AI assistant.", source: "demo" });
  }

  const { messages } = (await req.json().catch(() => ({}))) as {
    messages?: ChatMsg[];
  };
  const history = Array.isArray(messages) ? messages.slice(-12) : [];
  const last = history.filter((m) => m.role === "user").at(-1)?.content ?? "";

  const viewer = await getViewer();
  const ai = orgAIContext(viewer.org);
  const ctx = await buildContext(ai);

  if (!isAIConfigured()) {
    return NextResponse.json({ reply: demoReply(ctx, last), source: "demo" });
  }
  try {
    const reply = await chatComplete({
      system: SYSTEM(JSON.stringify(ctx), ai),
      messages: history,
    });
    return NextResponse.json({ reply: reply || demoReply(ctx, last), source: "claude" });
  } catch {
    return NextResponse.json({ reply: demoReply(ctx, last), source: "demo" });
  }
}
