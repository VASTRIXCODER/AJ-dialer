import {
  BarChart3,
  Battery,
  Bot,
  Car,
  Clock,
  Download,
  PhoneCall,
  PlayCircle,
  User,
  Waves,
  Zap,
} from "lucide-react";
import { AiExecReport } from "@/components/ai/exec-report";
import { HourlyBarChart, OutcomeDonut, TrendAreaChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getReportingData } from "@/lib/db/metrics";
import { outcomeConfig } from "@/lib/status";
import {
  formatClock,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  initials,
} from "@/lib/utils";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { metrics, kpiSeries, hourlyCalls, outcomeBreakdown, recentCalls } =
    await getReportingData();

  if (metrics.totalCalls === 0 && recentCalls.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Reports"
          description="Full visibility into calls, conversions, and the utility-bill patterns across your customer base."
        />
        <EmptyState
          icon={BarChart3}
          title="No report data yet"
          description="Call volume, connect rates, outcomes, utility-bill insights, and recordings appear here once dialing begins."
          action={{ label: "Open the dialer", href: "/dialer" }}
        />
      </PageContainer>
    );
  }

  const homeStats = [
    { label: "EV ownership", value: metrics.evOwnership, icon: Car },
    { label: "Pool ownership", value: metrics.poolOwnership, icon: Waves },
    { label: "Battery storage", value: metrics.batteryOwnership, icon: Battery },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        description="Full visibility into calls, conversions, and the utility-bill patterns across your customer base."
      >
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-4 w-4" />
          Export report
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total calls" value={formatNumber(metrics.totalCalls)} icon={PhoneCall} accent="primary" />
        <MetricCard label="Connect rate" value={formatPercent(metrics.connectRate, 1)} icon={Zap} accent="accent" />
        <MetricCard label="Appt rate" value={formatPercent(metrics.appointmentRate, 1)} icon={PlayCircle} accent="success" />
        <MetricCard label="Avg talk time" value={formatDuration(metrics.avgCallLenSec)} icon={Clock} accent="warning" />
      </div>

      <AiExecReport />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="Volume trend" description="Calls vs conversations" className="lg:col-span-2">
          <TrendAreaChart data={kpiSeries} />
        </SectionCard>
        <SectionCard title="Outcome mix" description="Disposition share">
          {outcomeBreakdown.length > 0 ? (
            <OutcomeDonut data={outcomeBreakdown} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No dispositions yet.
            </p>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="Hourly productivity" description="Dials & connects" className="lg:col-span-2">
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

      <SectionCard
        title="Recent calls"
        description="Latest dispositions with recordings"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Homeowner</th>
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3 text-right">Duration</th>
                <th className="px-5 py-3">Outcome</th>
                <th className="px-5 py-3 text-right">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentCalls.map((rec) => {
                const cfg = rec.outcome ? outcomeConfig[rec.outcome] : null;
                const recordingHref = !rec.hasRecording
                  ? null
                  : rec.channel === "ai" && rec.conversationId
                    ? `/api/elevenlabs/audio/${encodeURIComponent(rec.conversationId)}`
                    : rec.recordingUrl || null;
                return (
                  <tr key={rec.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3">
                      {rec.repName ? (
                        <div className="flex items-center gap-2">
                          <Avatar initials={initials(rec.repName)} color="#0EA5E9" size="xs" />
                          <span className="font-medium">{rec.repName}</span>
                        </div>
                      ) : (
                        <Badge tone={rec.channel === "ai" ? "accent" : "neutral"} className="gap-1">
                          {rec.channel === "ai" ? (
                            <Bot className="h-3 w-3" />
                          ) : (
                            <User className="h-3 w-3" />
                          )}
                          {rec.channel === "ai" ? "AI agent" : "Manual"}
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{rec.leadName}</td>
                    <td className="px-5 py-3 text-muted-foreground tabular">
                      {formatClock(rec.startedAt)}
                    </td>
                    <td className="px-5 py-3 text-right tabular">
                      {rec.durationSec ? formatDuration(rec.durationSec) : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {cfg ? <Badge tone={cfg.tone}>{cfg.label}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {recordingHref ? (
                        <a
                          href={recordingHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          <PlayCircle className="h-4 w-4" />
                          Play
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </PageContainer>
  );
}
