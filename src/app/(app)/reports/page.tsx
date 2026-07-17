import {
  BarChart3,
  Battery,
  CalendarRange,
  Car,
  Clock,
  Filter,
  PhoneCall,
  Target,
  Users,
  Waves,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { AiExecReport } from "@/components/ai/exec-report";
import { HourlyBarChart, OutcomeDonut, TrendAreaChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CallHistory } from "@/components/reports/call-history";
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
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getReportingData, getTeamLeaderboard } from "@/lib/db/metrics";
import { getViewer } from "@/lib/org/membership";
import { outcomeConfig } from "@/lib/status";
import { cn, formatCurrency, formatDuration, formatNumber, formatPercent } from "@/lib/utils";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

// Date-range presets for the period KPIs / dispositions / recent calls. The
// 7d/30d trend and today's hourly chart always keep their own fixed windows.
const RANGES = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: null },
] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const rangeKey = RANGES.some((r) => r.key === range) ? range! : "all";
  const rangeDays = RANGES.find((r) => r.key === rangeKey)?.days ?? null;

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
    { reps },
    viewer,
  ] = await Promise.all([getReportingData(rangeDays), getTeamLeaderboard(), getViewer()]);

  // Manual-only orgs (e.g. Donny) have no AI calls, so drop the AI-vs-human
  // split and the AI executive report — every call here is a human call.
  const aiDialerEnabled = viewer.org?.settings.features.aiDialer !== false;

  // Date-range switch — period figures react to it; the 30-day trend and
  // today's hourly chart keep their own fixed windows regardless.
  const rangeBar = (
    <div className="flex w-fit items-center gap-1 rounded-xl border border-border bg-card p-1">
      <span className="flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
        <CalendarRange className="h-3.5 w-3.5" />
      </span>
      {RANGES.map((r) => (
        <Link
          key={r.key}
          href={r.key === "all" ? "/reports" : `/reports?range=${r.key}`}
          className={cn(
            buttonVariants({ size: "sm", variant: rangeKey === r.key ? "primary" : "ghost" }),
          )}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );

  if (metrics.totalCalls === 0 && recentCalls.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Reports"
          description="Full visibility into calls, connect rates, every disposition, and team performance."
        />
        {rangeBar}
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
  const homeStats = [
    { label: "EV ownership", value: metrics.evOwnership, icon: Car },
    { label: "Pool ownership", value: metrics.poolOwnership, icon: Waves },
    { label: "Battery storage", value: metrics.batteryOwnership, icon: Battery },
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
        c.leadName,
        c.repName ?? "—",
        c.channel,
        c.outcome ? outcomeConfig[c.outcome].label : "—",
        c.durationSec,
      ]),
    },
  ];

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

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Total calls" value={formatNumber(metrics.totalCalls)} icon={PhoneCall} accent="primary" />
        <MetricCard label="Connect rate" value={formatPercent(metrics.connectRate, 1)} icon={Zap} accent="accent" />
        <MetricCard label="Connections" value={formatNumber(metrics.connections)} icon={Users} accent="primary" />
        {/* Booked appointment ROWS (appointments table), non-cancelled, scoped to
            the selected range — NOT funnel.appointments, which counts historical
            call_records outcomes and never shrinks after a lead is re-dispositioned.
            Same table the Dashboard + calendar use, so screens agree on the same
            window; the Dashboard just shows all-time. (Range-scoping is why
            Reports(Today) no longer reads "5 calls / 340 appointments".) */}
        <MetricCard label="Appointments" value={formatNumber(metrics.appointmentsBooked)} icon={Target} accent="success" sub="reviews on the books" />
        <MetricCard label="Avg talk time" value={formatDuration(metrics.avgCallLenSec)} icon={Clock} accent="warning" />
      </div>

      {/* Funnel + channel split (channel split only when AI is in play) */}
      <div className={aiDialerEnabled ? "grid grid-cols-1 gap-4 lg:grid-cols-2" : "grid grid-cols-1 gap-4"}>
        <SectionCard
          title="Conversion funnel"
          description="Dials → connects → appointments booked on calls (call outcomes, not the appointments calendar)"
        >
          <ReportFunnel funnel={funnel} />
        </SectionCard>
        {aiDialerEnabled && (
          <SectionCard title="AI vs human" description="Channel performance side by side">
            <ChannelCompare channelStats={channelStats} />
          </SectionCard>
        )}
      </div>

      {/* Trend + outcome mix */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="30-day volume trend" description="Calls vs conversations" className="lg:col-span-2">
          <TrendAreaChart data={trend30} />
        </SectionCard>
        <SectionCard title="Outcome mix" description="Disposition share">
          {outcomeBreakdown.length > 0 ? (
            <OutcomeDonut data={outcomeBreakdown} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No dispositions yet.</p>
          )}
        </SectionCard>
      </div>

      {/* All dispositions */}
      <SectionCard
        title="Disposition breakdown"
        description="Every outcome, by volume and share — connected outcomes ringed"
      >
        <DispositionBreakdown dispositions={dispositions} />
      </SectionCard>

      {/* Per-rep performance (supervisors) */}
      {teamWide && reps.length > 0 && (
        <SectionCard
          title="Rep performance"
          description="Last 30 days, ranked by performance score — its own fixed window, independent of the date range above"
          bodyClassName="p-0"
        >
          <RepPerformance reps={reps} />
        </SectionCard>
      )}

      {/* Hourly + utility insights */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="Hourly productivity" description="Dials & connects (today)" className="lg:col-span-2">
          <HourlyBarChart data={hourlyCalls} />
        </SectionCard>
        <SectionCard title="Utility-bill insights" description="Across qualified homeowners">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-muted p-3">
                <p className="text-lg font-bold tabular">{formatCurrency(metrics.avgUtilityBill)}</p>
                <p className="text-[10px] text-muted-foreground">Avg bill</p>
              </div>
              <div className="rounded-xl bg-muted p-3">
                <p className="text-lg font-bold tabular">{formatCurrency(metrics.avgSolarPayment)}</p>
                <p className="text-[10px] text-muted-foreground">Avg solar</p>
              </div>
              <div className="rounded-xl bg-primary-soft p-3">
                <p className="text-lg font-bold tabular text-primary">{formatCurrency(metrics.avgTotalEnergyCost)}</p>
                <p className="text-[10px] text-muted-foreground">Total cost</p>
              </div>
            </div>
            <div className="space-y-3 pt-1">
              {homeStats.map((s) => (
                <div key={s.label} className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <s.icon className="h-4 w-4" />
                  </div>
                  <span className="flex-1 text-sm text-muted-foreground">{s.label}</span>
                  <span className="text-sm font-bold tabular">{s.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      {aiDialerEnabled && <AiExecReport />}

      <SectionCard
        title="Call history"
        description={
          aiDialerEnabled
            ? "Every call, newest first (all time — not filtered by the date range above) — click any for the full breakdown (transcript, summary, appointment & recording)"
            : "Every call, newest first (all time — not filtered by the date range above) — click any for the full breakdown (summary, outcome & recording)"
        }
        bodyClassName="p-0"
      >
        <CallHistory />
      </SectionCard>
    </PageContainer>
  );
}
