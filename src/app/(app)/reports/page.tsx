import {
  Battery,
  Car,
  Clock,
  Download,
  PhoneCall,
  PlayCircle,
  Waves,
  Zap,
} from "lucide-react";
import { HourlyBarChart, OutcomeDonut, TrendAreaChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { outcomeConfig } from "@/lib/status";
import {
  callRecords,
  hourlyCalls,
  kpiSeries,
  metrics,
  outcomeBreakdown,
} from "@/lib/data";
import {
  formatClock,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  initials,
} from "@/lib/utils";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="Volume trend" description="Calls vs conversations" className="lg:col-span-2">
          <TrendAreaChart data={kpiSeries} />
        </SectionCard>
        <SectionCard title="Outcome mix" description="Disposition share">
          <OutcomeDonut data={outcomeBreakdown} />
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
        action={{ label: "View all", href: "/reports" }}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3">Rep</th>
                <th className="px-5 py-3">Homeowner</th>
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3 text-right">Duration</th>
                <th className="px-5 py-3">Outcome</th>
                <th className="px-5 py-3 text-right">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {callRecords.slice(0, 8).map((rec) => {
                const cfg = outcomeConfig[rec.outcome];
                return (
                  <tr key={rec.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar initials={initials(rec.repName)} color="#0EA5E9" size="xs" />
                        <span className="font-medium">{rec.repName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{rec.leadName}</td>
                    <td className="px-5 py-3 text-muted-foreground tabular">
                      {formatClock(rec.startedAt)}
                    </td>
                    <td className="px-5 py-3 text-right tabular">
                      {rec.durationSec ? formatDuration(rec.durationSec) : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={cfg.tone}>{cfg.label}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {rec.recordingUrl ? (
                        <button className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                          <PlayCircle className="h-4 w-4" />
                          Play
                        </button>
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
