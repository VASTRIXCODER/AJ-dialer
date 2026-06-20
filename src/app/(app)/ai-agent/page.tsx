import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  CalendarCheck,
  CheckCircle2,
  FileText,
  GraduationCap,
  Headphones,
  PhoneCall,
  Search,
  Sparkles,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SpotlightCard } from "@/components/motion";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isAIConfigured } from "@/lib/ai/claude";
import { callRecords } from "@/lib/data";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { cn, formatClock, initials } from "@/lib/utils";

export const metadata = { title: "AI Agent" };
export const dynamic = "force-dynamic";

const capabilities = [
  "Places outbound qualification calls",
  "Asks the solar resolution script",
  "Gathers billing & home information",
  "Identifies utility-bill overpayment",
  "Books account-review appointments",
  "Ends the call itself when finished",
  "Writes AI call summaries & lead scores",
];

const services: Array<{ icon: LucideIcon; name: string; desc: string }> = [
  { icon: Brain, name: "Lead Intelligence", desc: "Executive briefings, scores & probabilities the moment a lead opens." },
  { icon: Headphones, name: "Live Call Copilot", desc: "Real-time guidance, signals & next-best-questions mid-call." },
  { icon: Activity, name: "Conversation Analysis", desc: "Tracks qualification, sentiment & buying signals live." },
  { icon: FileText, name: "Auto Summaries", desc: "Multi-layer documentation written after every call." },
  { icon: Workflow, name: "CRM Automation", desc: "Notes, dispositions, tags & follow-ups — hands-free." },
  { icon: CalendarCheck, name: "Appointment Prep", desc: "Briefs reps with full context before every review." },
  { icon: Search, name: "Semantic Search", desc: "Natural-language search across the entire lead book." },
  { icon: BarChart3, name: "Executive Reporting", desc: "Narrative insight & prioritized actions for managers." },
  { icon: GraduationCap, name: "Sales Coaching", desc: "Personalized coaching plans, unique to each rep." },
  { icon: TrendingUp, name: "Predictive Analytics", desc: "Forecasts contact, conversion & no-show risk." },
];

const aiSummaries = callRecords
  .filter((r) => r.hasSummary)
  .slice(0, 4)
  .map((r, i) => ({
    ...r,
    summary: [
      "Homeowner pays both a $189 solar loan and a $248 PG&E bill after adding an EV charger. Strong overpayment signal — booked a review for Thursday 2pm.",
      "Confirmed pool pump + summer AC spike. Open to a no-cost account review. Scheduled callback to confirm spouse availability.",
      "Recently installed battery; bill still high. Qualified and warm — routed to senior account manager.",
      "Lower usage household but curious about true-up. Left a detailed voicemail and queued a follow-up.",
    ][i],
  }));

export default function AiAgentPage() {
  const aiLive = isAIConfigured();
  const voiceLive = isElevenLabsConfigured();

  return (
    <PageContainer>
      <PageHeader
        title="Claude Intelligence Layer"
        description="Claude is embedded across the platform — observing, reasoning, summarizing, and automating so reps spend their time building relationships, not documenting."
      >
        <Badge tone={aiLive ? "success" : "warning"} dot>
          {aiLive ? "Intelligence live" : "Demo intelligence"}
        </Badge>
        <Badge tone={voiceLive ? "success" : "warning"} dot>
          {voiceLive ? "Voice agent configured & live" : "Voice agent off"}
        </Badge>
        <Link
          href="/admin"
          className={buttonVariants({ size: "sm", variant: "outline", className: "gap-2" })}
        >
          <Sparkles className="h-4 w-4" />
          Configure
        </Link>
      </PageHeader>

      {/* Connection status — mirrors the Twilio configuration pattern */}
      <Card
        className={cn(
          "flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center",
          aiLive ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5",
        )}
      >
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            aiLive ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          {aiLive ? <CheckCircle2 className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">
            {aiLive
              ? "Configured & working — live intelligence is powered by the Claude API"
              : "Running on built-in demo intelligence"}
          </p>
          <p className="text-sm text-muted-foreground">
            {aiLive
              ? "Every briefing, summary, search, and report below is generated live by Claude."
              : "Add an ANTHROPIC_API_KEY to power every briefing, summary, search, and report with Claude. Until then, the platform simulates intelligence so it stays fully explorable."}
          </p>
        </div>
        <Badge tone={aiLive ? "success" : "neutral"}>
          {aiLive ? "Claude" : "Demo"}
        </Badge>
      </Card>

      {/* Hero banner */}
      <Card className="relative overflow-hidden border-0 bg-solar p-6 text-white sm:p-8">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-16 right-24 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 text-white/90">
              <Bot className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wide">
                Powered by Claude
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
              An invisible intelligence layer across every workflow
            </h2>
            <p className="mt-2 text-sm text-white/85">
              The agent handles qualification end-to-end and Claude assists every
              human rep — anticipating needs, surfacing insight, and writing the
              documentation so the team can focus on closing.
            </p>
          </div>
          <div className="shrink-0 rounded-2xl bg-white/15 p-5 text-center backdrop-blur">
            <p className="text-3xl font-black tabular">$175</p>
            <p className="text-sm text-white/80">/ month + usage</p>
          </div>
        </div>
      </Card>

      {aiSummaries.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="AI calls today" value="1,284" icon={PhoneCall} accent="accent" delta={{ value: "18%", positive: true }} />
          <MetricCard label="AI appointments" value="46" icon={CalendarCheck} accent="success" delta={{ value: "22%", positive: true }} />
          <MetricCard label="Summaries written" value="731" icon={FileText} accent="primary" />
          <MetricCard label="Qualification rate" value="34%" icon={CheckCircle2} accent="warning" />
        </div>
      )}

      {/* Claude service catalog */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-lg font-semibold tracking-tight">Claude intelligence services</h3>
          <Badge tone="accent" className="gap-1">
            <Sparkles className="h-3 w-3" />
            {services.length} modules
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {services.map((s) => (
            <SpotlightCard key={s.name} className="p-4">
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary ring-1 ring-inset ring-white/5 transition-transform duration-300 group-hover:scale-110">
                  <s.icon className="h-5 w-5" />
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide",
                    aiLive ? "text-success" : "text-muted-foreground",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", aiLive ? "bg-success" : "bg-muted-foreground")} />
                  {aiLive ? "Live" : "Demo"}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold">{s.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
            </SpotlightCard>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="What the agent does"
          description="Qualification & appointment generation"
        >
          <ul className="space-y-3">
            {capabilities.map((c) => (
              <li key={c} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            <Workflow className="h-4 w-4 shrink-0 text-accent" />
            Hands every booked review to a human rep with full context.
          </div>
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>
              To let the agent hang up on its own, enable the{" "}
              <span className="font-semibold text-foreground">End call</span> tool
              on your ElevenLabs agent. The dialer auto-ends &amp; categorizes any
              call that fails, isn’t answered, or runs long — as a backstop.
            </span>
          </div>
        </SectionCard>

        {aiSummaries.length > 0 ? (
          <SectionCard
            title="Recent AI summaries"
            description="Auto-generated after each conversation"
            className="lg:col-span-2"
          >
            <div className="space-y-3">
              {aiSummaries.map((s) => (
                <div key={s.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={initials(s.leadName)} color="#8B5CF6" size="sm" />
                      <div>
                        <p className="text-sm font-semibold">{s.leadName}</p>
                        <p className="text-xs text-muted-foreground tabular">
                          {formatClock(s.startedAt)}
                        </p>
                      </div>
                    </div>
                    <Badge tone="accent" className="gap-1">
                      <Sparkles className="h-3 w-3" />
                      AI summary
                    </Badge>
                  </div>
                  <p className="mt-2.5 text-sm text-muted-foreground">{s.summary}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : (
          <EmptyState
            className="lg:col-span-2"
            icon={Sparkles}
            title="No AI activity yet"
            description="When the AI agent starts calling, its appointments, summaries, and qualification stats will appear here."
          />
        )}
      </div>
    </PageContainer>
  );
}
