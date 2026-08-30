import {
  BarChart3,
  Bot,
  CalendarRange,
  Clock,
  Filter,
  GitCompareArrows,
  PhoneCall,
  Target,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { AiExecReport } from "@/components/ai/exec-report";
import { HourlyBarChart, OutcomeDonut, TrendAreaChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CallHistory } from "@/components/reports/call-history";
import { DataStamp } from "@/components/reports/data-stamp";
import { DrillLink } from "@/components/reports/drill-link";
import {
  FieldInsights,
  resolveFieldInsights,
} from "@/components/reports/field-insights";
import {
  ChannelCompare,
  DispositionBreakdown,
  ReportFunnel,
  RepPerformance,
} from "@/components/reports/report-sections";
import {
  type CsvSection,
  ExportReportButton,
} from "@/components/reports/export-report-button";
import { ReportViewPicker } from "@/components/reports/view-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { costBreakdown } from "@/lib/call-costs";
import { zonedDayKey } from "@/lib/dialer/schedule";
import { getReportingData, getTeamLeaderboard } from "@/lib/db/metrics";
import { resolveLeadFields } from "@/lib/leads/field-schema";
import { dayKeyLabel } from "@/lib/metrics/compute";
import { orgTimezone } from "@/lib/metrics/definitions";
import { getViewer } from "@/lib/org/membership";
import { DEFAULT_COST_RATES } from "@/lib/org/settings";
import { templateProfile } from "@/lib/org/templates";
import { orgVocabulary } from "@/lib/org/vocabulary";
import {
  drillAppointments,
  drillConnected,
  drillDialed,
  drillOutcome,
} from "@/lib/reports/drill";
import type { ReportRangeKey } from "@/lib/reports/view-spec";
import { resolveOutcomeConfig } from "@/lib/status";
import {
  cn,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  leadDisplayName,
} from "@/lib/utils";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

// Date-range presets for the period KPIs / dispositions / recent calls. The
// 7d/30d trend and today's hourly chart always keep their own fixed windows.
const RANGES: { key: ReportRangeKey; label: string; days: number | null }[] = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: null },
];

/** ▲/▼ delta for a KPI card vs the previous period, with the sr sentence. */
function kpiDelta(
  cur: number,
  prev: number | null,
  format: (n: number) => string,
  prevLabel: string,
): { value: string; positive: boolean; srLabel: string } | undefined {
  if (prev === null) return undefined;
  const diff = Math.round((cur - prev) * 10) / 10;
  if (diff === 0) return undefined; // no arrow for "no change" — nothing to claim
  const positive = diff > 0;
  return {
    value: format(Math.abs(diff)),
    positive,
    srLabel: `${positive ? "up" : "down"} ${format(Math.abs(diff))} vs previous period (${prevLabel})`,
  };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; compare?: string }>;
}) {
  const { range, compare } = await searchParams;
  const rangeKey: ReportRangeKey = RANGES.some((r) => r.key === range)
    ? (range as ReportRangeKey)
    : "all";
  const rangeDays = RANGES.find((r) => r.key === rangeKey)?.days ?? null;
  // Compare needs a bounded window — "all time" has no previous period.
  const compareOn = compare === "prev" && rangeDays != null;

  const [
    {
      metrics,
      kpiSeries,
      trend30,
      hourlyCalls,
      outcomeBreakdown,
      dispositions,
      channelStats,
      funnel,
      recentCalls,
      scope,
    },
    prevData,
    { reps },
    viewer,
  ] = await Promise.all([
    getReportingData(rangeDays),
    // The previous same-length window — a second full pass by design (the cost
    // is acceptable and it guarantees both windows use identical math).
    compareOn ? getReportingData(rangeDays, { periodOffsetDays: rangeDays! }) : null,
    getTeamLeaderboard(),
    getViewer(),
  ]);
  const prev = prevData?.metrics ?? null;

  // Manual-only orgs (e.g. Donny) have no AI calls, so drop the AI-vs-human
  // split and the AI executive report — every call here is a human call.
  const aiDialerEnabled = viewer.org?.settings.features.aiDialer !== false;

  // The workspace's own nouns — this page said "homeowners" and "reviews" to
  // every tenant regardless of what they sell.
  const vocab = orgVocabulary(viewer.org);
  const outcomes = resolveOutcomeConfig(vocab);

  // Every "day" on this page is the org's day. The stamp + range labels below
  // say so explicitly instead of leaving the boundary a mystery.
  const tz = orgTimezone(viewer.org);
  const generatedAt = new Date();
  const keyAgo = (daysBack: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return zonedDayKey(d, tz);
  };
  const todayKey = zonedDayKey(generatedAt, tz);
  const rangeStartKey = rangeDays ? keyAgo(rangeDays - 1) : null;
  const rangeLabel =
    rangeDays == null
      ? "All time"
      : rangeDays === 1
        ? dayKeyLabel(todayKey, { weekday: true })
        : `${dayKeyLabel(rangeStartKey!)} – ${dayKeyLabel(todayKey)}`;
  // The exact both-windows sentence ("Aug 22 – Aug 28 vs Aug 15 – Aug 21").
  const prevLabel =
    compareOn && rangeDays
      ? rangeDays === 1
        ? dayKeyLabel(keyAgo(1), { weekday: true })
        : `${dayKeyLabel(keyAgo(2 * rangeDays - 1))} – ${dayKeyLabel(keyAgo(rangeDays))}`
      : "";

  // Cost & usage: talk time × the org's per-minute rates (defaults apply when
  // the org never configured any). channelStats is already scoped to the
  // selected range, so the panel reacts to the range bar for free.
  const rates = viewer.org?.settings.costRates ?? DEFAULT_COST_RATES;
  const costs = costBreakdown(channelStats, rates);
  const aiCost = costs.perChannel.find((c) => c.channel === "ai");
  const humanCost = costs.perChannel.find((c) => c.channel === "human");

  const compareHref = (key: ReportRangeKey, on: boolean) => {
    const p = new URLSearchParams();
    if (key !== "all") p.set("range", key);
    if (on) p.set("compare", "prev");
    const qs = p.toString();
    return qs ? `/reports?${qs}` : "/reports";
  };

  // Date-range switch — period figures react to it; the 30-day trend and
  // today's hourly chart keep their own fixed windows regardless.
  const rangeBar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex w-fit items-center gap-1 rounded-xl border border-border bg-card p-1">
        <span className="flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
          <CalendarRange className="h-3.5 w-3.5" />
        </span>
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={compareHref(r.key, compareOn && r.days != null)}
            className={cn(
              buttonVariants({ size: "sm", variant: rangeKey === r.key ? "primary" : "ghost" }),
            )}
          >
            {r.label}
          </Link>
        ))}
      </div>
      {/* Comparison period: none | previous same-length window. */}
      <div className="flex w-fit items-center gap-1 rounded-xl border border-border bg-card p-1">
        <span className="flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
          <GitCompareArrows className="h-3.5 w-3.5" />
          Compare
        </span>
        {rangeDays == null ? (
          // All-time has no "previous period" — a disabled control with the
          // reason beats a toggle that silently does nothing.
          <span
            className="cursor-not-allowed px-2 py-1 text-xs text-muted-foreground/60"
            title="Pick a date range first — all time has no previous period."
          >
            needs a date range
          </span>
        ) : (
          <>
            <Link
              href={compareHref(rangeKey, false)}
              className={cn(
                buttonVariants({ size: "sm", variant: compareOn ? "ghost" : "primary" }),
              )}
            >
              Off
            </Link>
            <Link
              href={compareHref(rangeKey, true)}
              className={cn(
                buttonVariants({ size: "sm", variant: compareOn ? "primary" : "ghost" }),
              )}
            >
              Previous period
            </Link>
          </>
        )}
      </div>
      <ReportViewPicker
        views={viewer.org?.settings.reportViews ?? []}
        current={{ range: rangeKey, compare: compareOn ? "prev" : "none" }}
        canWrite={viewer.permissions.includes("org.edit")}
      />
    </div>
  );

  const stampLine = (
    <DataStamp
      generatedAt={generatedAt}
      timezone={tz}
      rangeLabel={compareOn ? `${rangeLabel} vs ${prevLabel}` : rangeLabel}
    />
  );

  if (metrics.totalCalls === 0 && recentCalls.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Reports"
          description="Full visibility into calls, connect rates, every disposition, and team performance."
        />
        {rangeBar}
        {stampLine}
        <EmptyState
          icon={BarChart3}
          title={rangeKey === "all" ? "No report data yet" : "No calls in this range"}
          description={
            rangeKey === "all"
              ? "Call volume, connect rates, dispositions, channel split, and recordings appear here once dialing begins."
              : "Try widening the date range — there are no calls in the selected window."
          }
          action={
            rangeKey === "all"
              ? { label: "Open the dialer", href: "/dialer" }
              : { label: "View all time", href: "/reports" }
          }
        />
      </PageContainer>
    );
  }

  const teamWide = scope === "org";
  // Book-wide insights in the ORG's own field labels. The panel this replaced
  // was gated on `dialerTemplate === "solar"` and hardcoded "Avg bill / Avg
  // solar / Total cost" over "qualified homeowners" — the same five typed
  // columns every vertical stores, described in one vertical's words.
  const fieldInsights = resolveFieldInsights(
    resolveLeadFields(
      viewer.org?.settings.leadFields,
      templateProfile(viewer.org?.dialerTemplate).fields,
    ),
    metrics,
  );
  const pipelineInsights = [
    { label: "Appointment rate", value: metrics.appointmentRate },
    { label: "Callback rate", value: metrics.callbackRate },
    { label: "No-answer rate", value: metrics.noAnswerRate },
  ];

  // CSV export — disposition summary + the recent-call log.
  const csvSections: CsvSection[] = [
    {
      title: "Disposition summary",
      headers: ["Disposition", "Count", "Share %", "Connected"],
      rows: dispositions.map((d) => [d.label, d.count, d.rate, d.connected ? "yes" : "no"]),
    },
    {
      title: "Recent calls",
      headers: ["Date", "Lead", "Rep", "Channel", "Disposition", "Duration (s)"],
      rows: recentCalls.map((c) => [
        new Date(c.startedAt).toLocaleString(),
        // A nameless row exports as the number the rep actually dialed rather
        // than an empty cell (or, as it used to, the word "Homeowner").
        leadDisplayName(c.leadName, c.phone, vocab.leadNoun),
        c.repName ?? "—",
        c.channel,
        c.outcome ? outcomes[c.outcome].label : "—",
        c.durationSec,
      ]),
    },
  ];

  const donutLegend = dispositions.filter((d) => d.count > 0);

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        description="Calls, connect rates, every disposition, channel split, and team performance."
      >
        <Badge tone={teamWide ? "primary" : "neutral"} className="gap-1">
          {teamWide ? <Users className="h-3 w-3" /> : <Filter className="h-3 w-3" />}
          {teamWide ? "Team-wide" : "Your calls"}
        </Badge>
        <ExportReportButton filename="aiatwork-report.csv" sections={csvSections} />
      </PageHeader>

      {rangeBar}
      {stampLine}

      {/* KPI row — every card drills into the matching leads; ⓘ = glossary. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <DrillLink filter={drillDialed(rangeDays)}>
          <MetricCard
            label="Total calls"
            value={formatNumber(metrics.totalCalls)}
            icon={PhoneCall}
            accent="primary"
            delta={kpiDelta(metrics.totalCalls, prev?.totalCalls ?? null, formatNumber, prevLabel)}
          />
        </DrillLink>
        <DrillLink filter={drillConnected(rangeDays)}>
          <MetricCard
            label="Connect rate"
            value={formatPercent(metrics.connectRate, 1)}
            icon={Zap}
            accent="accent"
            definitionKey="connect_rate"
            delta={kpiDelta(
              metrics.connectRate,
              prev?.connectRate ?? null,
              (n) => `${n.toFixed(1)} pp`,
              prevLabel,
            )}
          />
        </DrillLink>
        <DrillLink filter={drillConnected(rangeDays)}>
          <MetricCard
            label="Connections"
            value={formatNumber(metrics.connections)}
            icon={Users}
            accent="primary"
            definitionKey="human_connects"
            delta={kpiDelta(metrics.connections, prev?.connections ?? null, formatNumber, prevLabel)}
          />
        </DrillLink>
        {/* Booked appointment ROWS (appointments table), non-cancelled, scoped to
            the selected range — NOT funnel.appointments, which counts historical
            call_records outcomes and never shrinks after a lead is re-dispositioned.
            Same table the Dashboard + calendar use, so screens agree on the same
            window; the Dashboard just shows all-time. (Range-scoping is why
            Reports(Today) no longer reads "5 calls / 340 appointments".) */}
        <DrillLink filter={drillAppointments()}>
          <MetricCard
            label="Appointments"
            value={formatNumber(metrics.appointmentsBooked)}
            icon={Target}
            accent="success"
            sub={`${vocab.appointmentNounPlural} on the books`}
            definitionKey="appointments_set"
            delta={kpiDelta(
              metrics.appointmentsBooked,
              prev?.appointmentsBooked ?? null,
              formatNumber,
              prevLabel,
            )}
          />
        </DrillLink>
        {/* Avg talk time has no leads-side expression — honestly unlinked. */}
        <MetricCard
          label="Avg talk time"
          value={formatDuration(metrics.avgCallLenSec)}
          icon={Clock}
          accent="warning"
          definitionKey="avg_talk_time"
          delta={kpiDelta(
            metrics.avgCallLenSec,
            prev?.avgCallLenSec ?? null,
            formatDuration,
            prevLabel,
          )}
        />
      </div>

      {/* Funnel + channel split (channel split only when AI is in play) */}
      <div className={aiDialerEnabled ? "grid grid-cols-1 gap-4 lg:grid-cols-2" : "grid grid-cols-1 gap-4"}>
        <SectionCard
          title="Conversion funnel"
          description="Dials → connects → appointments booked on calls (call outcomes, not the appointments calendar)"
        >
          <ReportFunnel funnel={funnel} rangeDays={rangeDays} />
        </SectionCard>
        {aiDialerEnabled && (
          <SectionCard title="AI vs human" description="Channel performance side by side">
            <ChannelCompare channelStats={channelStats} />
          </SectionCard>
        )}
      </div>

      {/* Cost & usage — talk time × the org's per-minute rates, same range as
          the KPIs above. Estimates by design (per-minute billing increments and
          number fees are ignored); rates are editable in Admin → Organization
          settings, so the panel says so instead of looking authoritative. */}
      <SectionCard
        title="Cost & usage"
        description="Estimated call spend for the selected period, from talk time × your per-minute rates"
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label="Est. call spend"
            value={formatCurrency(costs.totalCost)}
            icon={Wallet}
            accent="primary"
          />
          {aiDialerEnabled && aiCost && (
            <MetricCard
              label="AI agent"
              value={formatCurrency(aiCost.cost)}
              icon={Bot}
              accent="accent"
              sub={`${formatNumber(aiCost.minutes)} min · ${formatNumber(aiCost.calls)} calls`}
            />
          )}
          {humanCost && (
            <MetricCard
              label="Human lines"
              value={formatCurrency(humanCost.cost)}
              icon={PhoneCall}
              accent="warning"
              sub={`${formatNumber(humanCost.minutes)} min · ${formatNumber(humanCost.calls)} calls`}
            />
          )}
          <MetricCard
            label="Cost per appointment"
            value={
              costs.costPerAppointment != null
                ? formatCurrency(costs.costPerAppointment)
                : "—"
            }
            icon={Target}
            accent="success"
            sub={
              costs.appointments > 0
                ? `${formatNumber(costs.appointments)} booked on calls`
                : "none booked in this period"
            }
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Estimates from talk time at {formatCurrency(rates.aiPerMinute)}/min (AI) and{" "}
          {formatCurrency(rates.manualPerMinute)}/min (human) — adjust the rates in
          Admin → Organization settings.
        </p>
      </SectionCard>

      {/* Trend + outcome mix */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="30-day volume trend" description="Calls vs conversations" className="lg:col-span-2">
          <TrendAreaChart data={trend30} />
        </SectionCard>
        <SectionCard title="Outcome mix" description="Disposition share">
          {outcomeBreakdown.length > 0 ? (
            <>
              <OutcomeDonut data={outcomeBreakdown} />
              {/* Legend rows drill into the leads whose latest outcome matches. */}
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                {donutLegend.map((d) => (
                  <DrillLink
                    key={d.key}
                    filter={drillOutcome(d.key, rangeDays)}
                    className="rounded-lg"
                  >
                    <span className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-xs transition-colors hover:bg-muted/40">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                      <span className="truncate text-muted-foreground">{d.label}</span>
                      <span className="ml-auto font-semibold tabular">{Math.round(d.rate)}%</span>
                    </span>
                  </DrillLink>
                ))}
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No dispositions yet.</p>
          )}
        </SectionCard>
      </div>

      {/* All dispositions */}
      <SectionCard
        title="Disposition breakdown"
        description="Every outcome, by volume and share — connected outcomes ringed. Click a row to open the matching leads."
      >
        <DispositionBreakdown dispositions={dispositions} rangeDays={rangeDays} />
      </SectionCard>

      {/* Per-rep performance (supervisors) */}
      {teamWide && reps.length > 0 && (
        <SectionCard
          title="Rep performance"
          description="This calendar month, ranked by leaderboard points — its own fixed window, independent of the date range above"
          bodyClassName="p-0"
        >
          <RepPerformance reps={reps} />
        </SectionCard>
      )}

      {/* Hourly + utility insights. Hourly bars deliberately have NO drill link:
          hour-of-day isn't expressible as a leads filter, and a wrong link is
          worse than none. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="Hourly productivity" description="Dials & connects (today)" className="lg:col-span-2">
          <HourlyBarChart data={hourlyCalls} />
        </SectionCard>
        {fieldInsights.length > 0 ? (
          <SectionCard
            title={`${vocab.LeadNoun} insights`}
            description={`Averages and ownership across your ${vocab.leadNounPlural}`}
          >
            <FieldInsights insights={fieldInsights} combinedLabel="Combined" />
          </SectionCard>
        ) : (
          <SectionCard title="Pipeline insights" description="Conversion across the funnel">
            <div className="space-y-4">
              {pipelineInsights.map((it) => (
                <div key={it.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{it.label}</span>
                    <span className="font-semibold tabular">{formatPercent(it.value, 1)}</span>
                  </div>
                  <Progress value={it.value} />
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      {aiDialerEnabled && <AiExecReport />}

      <SectionCard
        title="Call history"
        description="Every call, newest first (all time — not filtered by the date range above). Click any row for the summary, notes, transcript and recording."
        // Search, date ranges, per-rep filters and transcript search live on the
        // archive. This list stays as the at-a-glance feed and points at it,
        // rather than being the only way in.
        action={{ label: "Search recordings & transcripts", href: "/recordings" }}
        bodyClassName="p-0"
      >
        <CallHistory />
      </SectionCard>
    </PageContainer>
  );
}
