import {
  BarChart3,
  Battery,
  Car,
  Clock,
  Download,
  PhoneCall,
  PlayCircle,
  Waves,
  Zap,
} from "lucide-react";
import { AiExecReport } from "@/components/ai/exec-report";
import { HourlyBarChart, OutcomeDonut, TrendAreaChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RecentCalls } from "@/components/reports/recent-calls";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { getReportingData } from "@/lib/db/metrics";
import {
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
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
        description="Click any AI call for the full breakdown — transcript, summary, appointment & recording"
        bodyClassName="p-0"
      >
        <RecentCalls calls={recentCalls} />
      </SectionCard>
    </PageContainer>
  );
}
