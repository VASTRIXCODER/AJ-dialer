import {
  Bot,
  CalendarCheck,
  CheckCircle2,
  FileText,
  PhoneCall,
  Sparkles,
  Workflow,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { callRecords } from "@/lib/data";
import { formatClock, initials } from "@/lib/utils";

export const metadata = { title: "AI Agent" };

const capabilities = [
  "Places outbound qualification calls",
  "Asks the solar resolution script",
  "Gathers billing & home information",
  "Identifies utility-bill overpayment",
  "Books account-review appointments",
  "Writes AI call summaries & lead scores",
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
  return (
    <PageContainer>
      <PageHeader
        title="Solar Resolution AI Agent"
        description="Your always-on qualifier — it dials, asks the right questions, and books account reviews while your team focuses on closing."
      >
        <Badge tone="success" dot>
          Agent active
        </Badge>
        <Button size="sm" className="gap-2">
          <Sparkles className="h-4 w-4" />
          Configure
        </Button>
      </PageHeader>

      {/* Hero banner */}
      <Card className="relative overflow-hidden border-0 bg-solar p-6 text-white sm:p-8">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-16 right-24 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 text-white/90">
              <Bot className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wide">
                Optional add-on
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
              Qualification & appointment generation, on autopilot
            </h2>
            <p className="mt-2 text-sm text-white/85">
              The AI agent handles initial conversations end-to-end. It never
              closes the sale — it qualifies homeowners and hands warm,
              booked appointments to your reps.
            </p>
          </div>
          <div className="shrink-0 rounded-2xl bg-white/15 p-5 text-center backdrop-blur">
            <p className="text-3xl font-black tabular">$175</p>
            <p className="text-sm text-white/80">/ month + usage</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="AI calls today" value="1,284" icon={PhoneCall} accent="accent" delta={{ value: "18%", positive: true }} />
        <MetricCard label="AI appointments" value="46" icon={CalendarCheck} accent="success" delta={{ value: "22%", positive: true }} />
        <MetricCard label="Summaries written" value="731" icon={FileText} accent="primary" />
        <MetricCard label="Qualification rate" value="34%" icon={CheckCircle2} accent="warning" />
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
        </SectionCard>

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
      </div>
    </PageContainer>
  );
}
