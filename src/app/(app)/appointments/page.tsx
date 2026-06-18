import {
  CalendarCheck,
  CalendarX,
  Clock,
  MapPin,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { appointments, metrics } from "@/lib/data";
import type { Appointment } from "@/lib/types";
import {
  cn,
  formatClock,
  formatCurrency,
  formatDay,
  initials,
} from "@/lib/utils";

export const metadata = { title: "Appointments" };

const statusTone: Record<Appointment["status"], { tone: "success" | "warning" | "danger" | "neutral" | "accent"; label: string }> = {
  scheduled: { tone: "accent", label: "Scheduled" },
  completed: { tone: "success", label: "Completed" },
  no_show: { tone: "danger", label: "No-show" },
  rescheduled: { tone: "warning", label: "Rescheduled" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

export default function AppointmentsPage() {
  const sorted = [...appointments].sort(
    (a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt),
  );
  const upcoming = sorted.filter((a) => a.status === "scheduled");
  const past = sorted.filter((a) => a.status !== "scheduled");
  const showRate = Math.round(
    (metrics.appointmentsCompleted /
      (metrics.appointmentsCompleted + metrics.noShows)) *
      100,
  );

  const Row = ({ apt }: { apt: Appointment }) => {
    const cfg = statusTone[apt.status];
    return (
      <div className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/40">
        <div className="flex h-14 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-muted text-center">
          <span className="text-base font-bold leading-none tabular">
            {formatClock(apt.scheduledAt).split(" ")[0]}
          </span>
          <span className="text-[10px] font-bold uppercase text-muted-foreground">
            {formatClock(apt.scheduledAt).split(" ")[1]}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{apt.leadName}</p>
            {apt.source === "ai" && (
              <Badge tone="accent" className="gap-1">
                <Sparkles className="h-3 w-3" /> AI
              </Badge>
            )}
          </div>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            {apt.address}
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-sm font-bold tabular text-primary">
            {formatCurrency(apt.utilityBill)}
          </p>
          <p className="text-[11px] text-muted-foreground">utility / mo</p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <Avatar initials={initials(apt.repName)} color="#0EA5E9" size="xs" />
          <span className="text-xs text-muted-foreground">{apt.repName}</span>
        </div>
        <Badge tone={cfg.tone} className="shrink-0">
          {cfg.label}
        </Badge>
      </div>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="Appointments"
        description="Account reviews scheduled across reps and the AI agent."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Booked today" value={String(metrics.appointmentsBooked)} icon={CalendarCheck} accent="primary" delta={{ value: "9%", positive: true }} />
        <MetricCard label="Completed" value={String(metrics.appointmentsCompleted)} icon={TrendingUp} accent="success" />
        <MetricCard label="No-shows" value={String(metrics.noShows)} icon={CalendarX} accent="danger" />
        <MetricCard label="Show rate" value={`${showRate}%`} icon={RefreshCw} accent="accent" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border p-5">
            <div>
              <h3 className="font-semibold">Upcoming</h3>
              <p className="text-xs text-muted-foreground">{upcoming.length} scheduled</p>
            </div>
            <Badge tone="success" dot>
              Next: {formatClock(upcoming[0]?.scheduledAt ?? new Date().toISOString())}
            </Badge>
          </div>
          <div className="divide-y divide-border">
            {upcoming.map((apt) => (
              <Row key={apt.id} apt={apt} />
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <h3 className="font-semibold">Recent history</h3>
            <p className="text-xs text-muted-foreground">Completed & missed</p>
          </div>
          <div className="divide-y divide-border">
            {past.map((apt) => (
              <div key={apt.id} className="flex items-center gap-3 p-4">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    apt.status === "completed"
                      ? "bg-success/12 text-success"
                      : "bg-danger/12 text-danger",
                  )}
                >
                  {apt.status === "completed" ? (
                    <CalendarCheck className="h-4 w-4" />
                  ) : (
                    <CalendarX className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{apt.leadName}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDay(apt.scheduledAt)}
                  </p>
                </div>
                <Badge tone={statusTone[apt.status].tone}>
                  {statusTone[apt.status].label}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
