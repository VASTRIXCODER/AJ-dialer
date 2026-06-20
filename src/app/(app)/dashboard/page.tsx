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
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getReportingData } from "@/lib/db/metrics";
import {
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const liveTone = (s: string) =>
  s === "in_progress" ? "success" : s === "failed" ? "danger" : "warning";
const liveLabel = (s: string) =>
  s === "in_progress" ? "On call" : s === "initiated" ? "Dialing" : s.replace("_", " ");

export default async function DashboardPage() {
  const {
    metrics,
    kpiSeries,
    outcomeBreakdown,
    hourlyCalls,
    liveCalls,
    appointments,
    leaderboard,
  } = await getReportingData();

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
        description="Here's how the floor is performing across every active campaign."
      >
        <Badge tone="success" dot>
          {liveCalls.length} live calls
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
          sub="dials placed today"
        />
        <MetricCard
          label="Connect rate"
          value={formatPercent(metrics.connectRate, 1)}
          icon={Zap}
          accent="accent"
          sub="conversations / dials"
        />
        <MetricCard
          label="Appointments"
          value={formatNumber(metrics.appointmentsBooked)}
          icon={CalendarCheck}
          accent="success"
          sub="reviews booked"
        />
        <MetricCard
          label="Avg talk time"
          value={formatDuration(metrics.avgCallLenSec)}
          icon={Clock}
          accent="warning"
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

        <SectionCard title="Outcome mix" description="Disposition share">
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
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-solar text-white shadow-glow">
                    <Bot className="h-4 w-4" />
                    {call.state === "in_progress" && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{call.leadName}</p>
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
          description="Account reviews on the calendar"
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
                    <p className="truncate text-sm font-semibold">{apt.leadName}</p>
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
          description="By performance score"
          action={{ label: "Leaderboard", href: "/leaderboard" }}
        >
          {leaderboard.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Rankings appear as calls are logged.
            </p>
          ) : (
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
          )}
        </SectionCard>
      </div>
    </PageContainer>
  );
}
