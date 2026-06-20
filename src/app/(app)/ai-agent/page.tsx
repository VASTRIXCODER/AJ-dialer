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
  Lightbulb,
  Search,
  Sparkles,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { ChatAssistant } from "@/components/ai/chat-assistant";
import { SpotlightCard } from "@/components/motion";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { isAIConfigured } from "@/lib/ai/claude";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { cn } from "@/lib/utils";

export const metadata = { title: "AI Command Center" };
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

const tips = [
  "“Brief me on today and tell me what to prioritize.”",
  "“Which leads have the highest overpayment signal?”",
  "“Walk me through starting a 3× AI calling session.”",
  "“What's my connect rate and how do I improve it?”",
  "“Summarize my upcoming appointments and due callbacks.”",
];

export default function AiAgentPage() {
  const aiLive = isAIConfigured();
  const voiceLive = isElevenLabsConfigured();

  return (
    <PageContainer>
      <PageHeader
        title="AI Command Center"
        description="Your central AI assistant — it briefs you, oversees the floor, and powers the whole solar-resolution intelligence layer."
      >
        <Badge tone={aiLive ? "success" : "warning"} dot>
          {aiLive ? "Intelligence live" : "Demo intelligence"}
        </Badge>
        <Badge tone={voiceLive ? "success" : "warning"} dot>
          {voiceLive ? "Voice agent configured & live" : "Voice agent off"}
        </Badge>
      </PageHeader>

      {/* Connection status */}
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
              ? "The assistant below, plus every briefing, summary, search, and report, is generated live by Claude."
              : "Add an ANTHROPIC_API_KEY to power the assistant and every briefing, summary, search, and report with Claude. Until then it answers from your live floor data."}
          </p>
        </div>
        <Badge tone={aiLive ? "success" : "neutral"}>{aiLive ? "Claude" : "Demo"}</Badge>
      </Card>

      {/* Centerpiece — the AI assistant */}
      <ChatAssistant />

      {/* What you can ask + what the agent does */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Try asking"
          description="The assistant knows your live numbers"
          className="lg:col-span-2"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {tips.map((t) => (
              <div
                key={t}
                className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-surface/50 p-3 text-sm text-muted-foreground"
              >
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="What the agent does" description="On every outbound call">
          <ul className="space-y-3">
            {capabilities.map((c) => (
              <li key={c} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

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
    </PageContainer>
  );
}
