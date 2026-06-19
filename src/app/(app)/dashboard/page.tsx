import {
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
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  activeCalls,
  appointments,
  hourlyCalls,
  kpiSeries,
  leaderboard,
  metrics,
  outcomeBreakdown,
} from "@/lib/data";
import {
  formatClock,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const hasData =
    metrics.totalCalls > 0 || kpiSeries.length > 0 || activeCalls.length > 0;

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
          description="Connect your lead source and start dialing — calls, connect rates, appointments, and live monitoring will populate here in real time."
          action={{ label: "Open the dialer", href: "/dialer" }}
        />
      </PageContainer>
    );
  }

  const upcoming = appointments
    .filter((a) => a.status === "scheduled")
    .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))
    .slice(0, 4);

  const utilityInsights = [
    { label: "Avg utility bill", value: formatCurrency(metrics.avgUtilityBill), pct: 58 },
    { label: "Avg solar payment", value: formatCurrency(metrics.avgSolarPayment), pct: 42 },
    { label: "EV ownership", value: formatPercent(metrics.evOwnership), pct: metrics.evOwnership },
    { label: "Pool ownership", value: formatPercent(metrics.poolOwnership), pct: metrics.poolOwnership },
    { label: "Battery storage", value: formatPercent(metrics.batteryOwnership), pct: metrics.batteryOwnership },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={greeting()}
        description="Here's how the floor is performing today across every active campaign."
      >
        <Badge tone="success" dot>
          {activeCalls.filter((c) => c.state === "connected").length} live calls
        </Badge>
        <Link href="/dialer" className={buttonVariants({ size: "sm", className: "gap-2" })}>
          <PhoneCall className="h-4 w-4" />
          Start dialing
        </Link>
      </PageHeader>

      {/* Hero metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Calls today"
          value={formatNumber(metrics.callsToday)}
          icon={PhoneCall}
          accent="primary"
          delta={{ value: "12.4%", positive: true }}
          sub="vs yesterday"
        />
        <MetricCard
          label="Connect rate"
          value={formatPercent(metrics.connectRate, 1)}
          icon={Zap}
          accent="accent"
          delta={{ value: "1.8%", positive: true }}
          sub="vs yesterday"
        />
        <MetricCard
          label="Appointments"
          value={formatNumber(metrics.appointmentsBooked)}
          icon={CalendarCheck}
          accent="success"
          delta={{ value: "9.1%", positive: true }}
          sub="booked today"
        />
        <MetricCard
          label="Avg talk time"
          value={formatDuration(metrics.avgCallLenSec)}
          icon={Clock}
          accent="warning"
          delta={{ value: "4s", positive: false }}
          sub="per conversation"
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

        <SectionCard title="Outcome mix" description="Last 1,000 dispositions">
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
          title="Utility insights"
          description="Across qualified homeowners"
          action={{ label: "Details", href: "/reports" }}
        >
          <div className="space-y-4">
            {utilityInsights.map((it) => (
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
          description="Active conversations on the floor"
          action={{ label: "Monitor", href: "/monitor" }}
        >
          <ul className="space-y-3">
            {activeCalls.slice(0, 4).map((call) => (
              <li key={call.id} className="flex items-center gap-3">
                <span className="relative">
                  <Avatar initials={call.repInitials} color={call.repColor} size="sm" />
                  {call.state === "connected" && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{call.repName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    with {call.leadName} · {call.leadCity}
                  </p>
                </div>
                <Badge
                  tone={call.state === "connected" ? "success" : call.state === "ringing" ? "warning" : "neutral"}
                  dot
                  className="capitalize"
                >
                  {call.state.replace("_", " ")}
                </Badge>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Today's appointments"
          description="Account reviews on the calendar"
          action={{ label: "All", href: "/appointments" }}
        >
          <ul className="space-y-3">
            {upcoming.map((apt) => (
              <li key={apt.id} className="flex items-center gap-3">
                <div className="flex h-11 w-12 flex-col items-center justify-center rounded-xl bg-muted text-center">
                  <span className="text-sm font-bold leading-none tabular">
                    {formatClock(apt.scheduledAt).split(" ")[0]}
                  </span>
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    {formatClock(apt.scheduledAt).split(" ")[1]}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{apt.leadName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {apt.repName} · {formatCurrency(apt.utilityBill)} bill
                  </p>
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
        </SectionCard>

        <SectionCard
          title="Top performers"
          description="By performance score"
          action={{ label: "Leaderboard", href: "/leaderboard" }}
        >
          <ul className="space-y-3">
            {leaderboard.slice(0, 5).map((rep, i) => (
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
                <Avatar initials={rep.initials} color={rep.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{rep.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {rep.appointmentsToday} appts · {rep.callsToday} calls
                  </p>
                </div>
                <div className="flex items-center gap-1 text-sm font-bold text-success">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {rep.score}
                </div>
                {i === 0 && <Trophy className="h-4 w-4 text-warning" />}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </PageContainer>
  );
}
