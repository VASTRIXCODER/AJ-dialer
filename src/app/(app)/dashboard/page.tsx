import {
  Bot,
  CalendarCheck,
  Clock,
  LayoutDashboard,
  PhoneCall,
  Sparkles,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { HourlyBarChart, OutcomeDonut, TrendAreaChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { DataStamp } from "@/components/reports/data-stamp";
import { resolveFieldInsights } from "@/components/reports/field-insights";
import { EmptyState } from "@/components/shared/empty-state";
import { HotQueue } from "@/components/dashboard/hot-queue";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getReportingData, getTeamLeaderboard } from "@/lib/db/metrics";
import { compareRanked } from "@/lib/leaderboard";
import { resolveLeadFields } from "@/lib/leads/field-schema";
import { orgTimezone } from "@/lib/metrics/definitions";
import { getViewer } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";
import { orgVocabulary } from "@/lib/org/vocabulary";
import { liveStateConfig } from "@/lib/status";
import type { AILiveState } from "@/lib/types";
import {
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  leadDisplayName,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// The shared lifecycle map (src/lib/status.ts). This file used to define its own
// third variant, which disagreed with both the monitor's and the call dashboard's.
const liveTone = (s: string) =>
  liveStateConfig[s as AILiveState]?.tone ?? "neutral";
const liveLabel = (s: string) =>
  liveStateConfig[s as AILiveState]?.label ?? s.replace("_", " ");

export default async function DashboardPage() {
  const [
    { metrics, kpiSeries, outcomeBreakdown, hourlyCalls, liveCalls, appointments, connectRateToday },
    viewer,
    { reps: teamReps, meId },
    // The dashboard's headline KPIs / dispositions / pipeline insights are scoped
    // to the last 90 days rather than all-time. Rendering them used to page an
    // org's ENTIRE call history into the server render — for the largest org that
    // was tens of thousands of rows per load and grew unbounded with volume. A
    // 90-day window keeps the dashboard fast and flat as the org grows (the 7-day
    // trend and today's tiles are unaffected). Reports still offers true all-time.
  ] = await Promise.all([getReportingData(90), getViewer(), getTeamLeaderboard()]);

  // Top performers today, org-wide (every onboarded member counts) — ranked by
  // the org's configurable leaderboard points, with the one deterministic
  // tie-break every leaderboard surface shares (src/lib/leaderboard.ts).
  const leaderboard = [...teamReps]
    .sort((a, b) => compareRanked({ id: a.id, stat: a.daily }, { id: b.id, stat: b.daily }))
    .slice(0, 5);

  const org = viewer.org;
  const vocab = orgVocabulary(org);
  const floorName = org?.productName || org?.name || "your floor";
  // The org's own field labels — this panel used to print one tenant's column
  // names ("Avg utility bill", "Avg solar payment", "Battery storage") on every
  // workspace's dashboard.
  const fieldInsights = resolveFieldInsights(
    resolveLeadFields(
      org?.settings.leadFields,
      templateProfile(org?.dialerTemplate).fields,
    ),
    metrics,
  );

  const hasData =
    metrics.totalCalls > 0 || liveCalls.length > 0 || appointments.length > 0;

  if (!hasData) {
    return (
      <PageContainer>
        <PageHeader
          title={greeting()}
          description="Your floor analytics will appear here once calling begins."
        />
        <EmptyState
          icon={LayoutDashboard}
          title="No activity yet"
          description="Import your leads and start dialing — calls, connect rates, appointments, and live monitoring will populate here in real time."
          action={{ label: "Open the dialer", href: "/dialer" }}
        />
      </PageContainer>
    );
  }

  const upcoming = appointments
    .filter((a) => a.status === "scheduled")
    .slice(0, 4);

  // Book-wide field insights, in the org's own words. `pct` drives the bar: a
  // share is already a percentage; a money figure has no natural denominator, so
  // it renders as the fraction of the combined money total — which is what the
  // old fixed 58/42 split was hand-waving at.
  const insightMoneyTotal = fieldInsights
    .filter((i) => i.kind === "money")
    .reduce((sum, i) => sum + i.value, 0);
  const bareLabel = (label: string) =>
    label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
  const schemaInsights = fieldInsights.map((i) =>
    i.kind === "money"
      ? {
          label: `Avg ${bareLabel(i.label).toLowerCase()}`,
          value: formatCurrency(i.value),
          pct: insightMoneyTotal > 0 ? Math.round((i.value / insightMoneyTotal) * 100) : 0,
        }
      : { label: bareLabel(i.label), value: formatPercent(i.value), pct: i.value },
  );

  // Funnel insights — the fallback for an org whose schema exposes none of the
  // typed profile slots above.
  const pipelineInsights = [
    { label: "Connect rate", value: formatPercent(metrics.connectRate, 1), pct: metrics.connectRate },
    { label: "Appointment rate", value: formatPercent(metrics.appointmentRate, 1), pct: metrics.appointmentRate },
    { label: "Callback rate", value: formatPercent(metrics.callbackRate, 1), pct: metrics.callbackRate },
    { label: "No-answer rate", value: formatPercent(metrics.noAnswerRate, 1), pct: metrics.noAnswerRate },
  ];

  const insights = schemaInsights.length > 0 ? schemaInsights : pipelineInsights;

  return (
    <PageContainer>
      <PageHeader
        title={greeting()}
        description={`Here's how ${floorName} is performing across every active campaign.`}
      >
        <Badge tone="success" dot>
          {liveCalls.length} live calls
        </Badge>
        <Link href="/dialer" className={buttonVariants({ size: "sm", className: "gap-2" })}>
          <PhoneCall className="h-4 w-4" />
          Start dialing
        </Link>
      </PageHeader>

      {/* Force-dynamic page ⇒ render time IS the data's freshness. */}
      <DataStamp generatedAt={new Date()} timezone={orgTimezone(org)} />

      {/* Hot signals (P2.6): the orchestration engine's escalations + any
          detector's output. Renders NOTHING when the queue is clear. */}
      <HotQueue />

      {/* Hero metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Calls today"
          value={formatNumber(metrics.callsToday)}
          icon={PhoneCall}
          accent="primary"
          sub="dials placed today"
          definitionKey="calls_today"
        />
        <MetricCard
          label="Connect rate"
          value={formatPercent(connectRateToday, 1)}
          icon={Zap}
          accent="accent"
          sub="conversations / dials · today"
          definitionKey="connect_rate"
        />
        <MetricCard
          label="Appointments"
          value={formatNumber(metrics.appointmentsBooked)}
          icon={CalendarCheck}
          accent="success"
          // The org's own noun — this tile said "reviews booked" to every tenant.
          sub={`${vocab.appointmentNounPlural} booked · 90d`}
          definitionKey="appointments_set"
        />
        <MetricCard
          label="Avg talk time"
          value={formatDuration(metrics.avgCallLenSec)}
          icon={Clock}
          accent="warning"
          sub="per conversation · 90d"
          definitionKey="avg_talk_time"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Performance this week"
          description="Dials vs. live conversations"
          className="lg:col-span-2"
          action={{ label: "Reports", href: "/reports" }}
        >
          <TrendAreaChart data={kpiSeries} />
        </SectionCard>

        <SectionCard title="Outcome mix" description="Disposition share · last 90 days">
          {outcomeBreakdown.length > 0 ? (
            <>
              <OutcomeDonut data={outcomeBreakdown} />
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                {outcomeBreakdown.map((o) => (
                  <div key={o.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: o.color }} />
                    <span className="text-muted-foreground">{o.name}</span>
                    <span className="ml-auto font-semibold tabular">{o.value}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No dispositions yet.
            </p>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Hourly productivity"
          description="Dials and connects by hour"
          className="lg:col-span-2"
        >
          <HourlyBarChart data={hourlyCalls} />
        </SectionCard>

        <SectionCard
          title={schemaInsights.length > 0 ? `${vocab.LeadNoun} insights` : "Pipeline insights"}
          description={
            schemaInsights.length > 0
              ? `Across your ${vocab.leadNounPlural}`
              : "Conversion · last 90 days"
          }
          action={{ label: "Details", href: "/reports" }}
        >
          <div className="space-y-4">
            {insights.map((it) => (
              <div key={it.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{it.label}</span>
                  <span className="font-semibold tabular">{it.value}</span>
                </div>
                <Progress value={it.pct} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Live + appointments + leaderboard */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Live now"
          description="Active AI conversations"
          action={{ label: "Monitor", href: "/monitor" }}
        >
          {liveCalls.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No live calls right now.
            </p>
          ) : (
            <ul className="space-y-3">
              {liveCalls.slice(0, 5).map((call) => (
                <li key={call.id} className="flex items-center gap-3">
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-glow">
                    <Bot className="h-4 w-4" />
                    {call.state === "in_progress" && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {leadDisplayName(call.leadName, null, vocab.leadNoun)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {call.city || "AI agent"}
                    </p>
                  </div>
                  <Badge tone={liveTone(call.state)} dot className="capitalize">
                    {liveLabel(call.state)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Upcoming appointments"
          description={`${vocab.appointmentNounPlural.charAt(0).toUpperCase()}${vocab.appointmentNounPlural.slice(1)} on the calendar`}
          action={{ label: "All", href: "/appointments" }}
        >
          {upcoming.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing scheduled yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((apt) => (
                <li key={apt.id} className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <CalendarCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {leadDisplayName(apt.leadName, null, vocab.leadNoun)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{apt.whenLabel}</p>
                  </div>
                  {apt.source === "ai" && (
                    <Badge tone="accent" className="gap-1">
                      <Sparkles className="h-3 w-3" />
                      AI
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Top performers"
          description="By leaderboard points · today"
          action={{ label: "Leaderboard", href: "/leaderboard" }}
        >
          {leaderboard.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Rankings appear as calls are logged.
            </p>
          ) : (
            <ul className="space-y-3">
              {leaderboard.map((rep, i) => (
                <li key={rep.id} className="flex items-center gap-3">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold tabular ${
                      i === 0
                        ? "bg-warning/20 text-warning"
                        : i === 1
                          ? "bg-muted-foreground/15 text-muted-foreground"
                          : i === 2
                            ? "bg-primary-soft text-primary"
                            : "text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <Avatar initials={rep.initials} color={rep.avatarColor || undefined} seed={rep.id} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {rep.name}
                      {rep.id === meId && <span className="text-primary"> (You)</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {rep.daily.appointments} appts · {rep.daily.calls} calls
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-bold text-success">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {rep.daily.points}
                  </div>
                  {i === 0 && <Trophy className="h-4 w-4 text-warning" />}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </PageContainer>
  );
}
