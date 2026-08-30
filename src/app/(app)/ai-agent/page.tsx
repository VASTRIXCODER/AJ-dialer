import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  CheckCircle2,
  FileText,
  Headphones,
  Lightbulb,
  Lock,
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
import { isAIConfigured, pingAI } from "@/lib/ai/claude";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { getViewer } from "@/lib/org/membership";
import { orgVocabulary, type OrgVocabulary } from "@/lib/org/vocabulary";
import { cn } from "@/lib/utils";

export const metadata = { title: "AI Command Center" };
export const dynamic = "force-dynamic";

// What the voice agent does, in the workspace's own words. This used to be a
// solar list with a couple of `isSolar ?` swaps, so every other vertical was
// told the agent "gathers billing & home information" and "books account-review
// appointments" — neither of which is true of a recruiting or healthcare call.
function capabilitiesFor(vocab: OrgVocabulary) {
  return [
    `Places outbound calls to your ${vocab.leadNounPlural}`,
    "Asks your qualification script",
    "Captures the fields you qualify on",
    vocab.isSolar ? "Identifies utility-bill overpayment" : "Identifies buying signals",
    `Books ${vocab.appointmentNounPlural}`,
    "Ends the call itself when finished",
    "Writes AI call summaries & lead scores",
  ];
}

// Every card here maps to a REAL implementation (a service in
// src/lib/ai/services.ts + an /api/ai route, or the ai-call-finalize
// pipeline). Two former cards — "Appointment Prep" and "Sales Coaching" —
// were removed rather than left badging "Live" with nothing behind them
// (P5.AICARDS); prep duplicated Lead Intelligence, coaching had no service
// and no consuming surface. Don't add a card without shipping its service.
const services: Array<{ icon: LucideIcon; name: string; desc: string }> = [
  { icon: Brain, name: "Lead Intelligence", desc: "Executive briefings, scores & probabilities the moment a lead opens." },
  { icon: Headphones, name: "Live Call Copilot", desc: "Real-time guidance, signals & next-best-questions mid-call." },
  { icon: Activity, name: "Conversation Analysis", desc: "Turns every AI call transcript into disposition, sentiment & qualification data." },
  { icon: FileText, name: "Auto Summaries", desc: "Multi-layer documentation written after every call." },
  { icon: Workflow, name: "CRM Automation", desc: "AI calls auto-disposition, summarize & file appointments — hands-free." },
  { icon: Search, name: "Semantic Search", desc: "Natural-language search across the entire lead book." },
  { icon: BarChart3, name: "Executive Reporting", desc: "Narrative insight & prioritized actions for managers." },
  { icon: TrendingUp, name: "Predictive Analytics", desc: "Contact, conversion & qualification probabilities on every briefing." },
];

function tipsFor(vocab: OrgVocabulary) {
  return [
    "“Brief me on today and tell me what to prioritize.”",
    vocab.isSolar
      ? `“Which ${vocab.leadNounPlural} have the highest overpayment signal?”`
      : `“Which ${vocab.leadNounPlural} have the highest buying signal?”`,
    "“Walk me through starting a 3× AI calling session.”",
    "“What's my connect rate and how do I improve it?”",
    `“Summarize my upcoming ${vocab.appointmentNounPlural} and due callbacks.”`,
  ];
}

export default async function AiAgentPage() {
  const viewer = await getViewer();
  // "Live" means Claude is ACTUALLY reachable and the model resolves — not merely
  // that a key is present. Without this the badge said "live" even when the key
  // was invalid or the model unavailable, while every surface silently served
  // demo data. pingAI is one tiny round-trip and never throws; skipped entirely
  // when no key is configured (so demo mode makes no wasted call).
  const aiLive = isAIConfigured() ? (await pingAI()).ok : false;
  const voiceLive = isElevenLabsConfigured();
  const vocab = orgVocabulary(viewer.org);
  const capabilities = capabilitiesFor(vocab);
  const tips = tipsFor(vocab);
  const intelligenceLayerDesc =
    "Your central AI assistant — it briefs you, oversees the floor, and powers the whole calling intelligence layer.";
  const aiOrgEnabled =
    viewer.org?.settings?.features?.aiDialer !== false &&
    viewer.org?.settings?.features?.aiAgent !== false;

  if (!aiOrgEnabled) {
    return (
      <PageContainer>
        <PageHeader title="AI Command Center" description={intelligenceLayerDesc} />
        <Card className="flex flex-col items-center gap-6 px-8 py-16 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-3xl border-2 border-dashed border-border bg-muted/40">
            <Lock className="h-9 w-9 text-ink-3" />
          </span>
          <div className="max-w-md">
            <p className="text-xl font-bold tracking-tight">
              AI features are switched off for this workspace
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The <span className="font-semibold text-foreground">AI calling</span> and{" "}
              <span className="font-semibold text-foreground">AI agent</span> feature flags are
              off. An owner or admin can turn them on in Admin → Features &amp; terminology —
              or from the AI agent panel’s “Enable AI calling” button.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {["AI Voice Agent", "Live Copilot", "Call Summaries", "Lead Intelligence", "Semantic Search"].map(
              (f) => (
                <span
                  key={f}
                  className="flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  <Lock className="h-3 w-3" />
                  {f}
                </span>
              ),
            )}
          </div>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="AI Command Center" description={intelligenceLayerDesc}>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {services.map((s) => (
            <SpotlightCard key={s.name} className="p-4">
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary ring-1 ring-inset ring-white/5 transition-transform duration-300 group-hover:scale-110">
                  <s.icon className="h-5 w-5" />
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide",
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
