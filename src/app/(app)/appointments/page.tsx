import { CalendarCheck, CalendarX, Clock, Sparkles, Users } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RowActions } from "@/components/pipeline/row-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getAppointments, type AppointmentRow } from "@/lib/db/pipeline";

const APPT_STATUS_OPTIONS = [
  { value: "completed", label: "Mark completed" },
  { value: "no_show", label: "Mark no-show" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancel" },
  { value: "scheduled", label: "Re-open (scheduled)" },
];

export const metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

const statusTone: Record<
  string,
  { tone: "success" | "warning" | "danger" | "neutral" | "accent"; label: string }
> = {
  scheduled: { tone: "accent", label: "Scheduled" },
  completed: { tone: "success", label: "Completed" },
  no_show: { tone: "danger", label: "No-show" },
  rescheduled: { tone: "warning", label: "Rescheduled" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

function whenLabel(a: AppointmentRow): string {
  if (a.scheduledLabel) return a.scheduledLabel;
  if (a.scheduledAt) {
    return new Date(a.scheduledAt).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return new Date(a.createdAt).toLocaleDateString();
}

export default async function AppointmentsPage() {
  const appts = await getAppointments();

  if (appts.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Appointments"
          description="Account reviews scheduled across reps and the AI agent."
        />
        <EmptyState
          icon={CalendarCheck}
          title="No appointments scheduled"
          description="Booked account reviews from your reps and the AI agent appear here automatically."
          action={{ label: "Open the dialer", href: "/dialer" }}
        />
      </PageContainer>
    );
  }

  const scheduled = appts.filter((a) => a.status === "scheduled");
  const completed = appts.filter((a) => a.status === "completed").length;
  const noShows = appts.filter((a) => a.status === "no_show").length;
  const showRate = completed + noShows
    ? Math.round((completed / (completed + noShows)) * 100)
    : 0;

  const teamWide = appts[0]?.teamWide;

  const Row = ({ a }: { a: AppointmentRow }) => {
    const cfg = statusTone[a.status] ?? statusTone.scheduled;
    return (
      <div className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/40">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <CalendarCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{a.leadName}</p>
            {a.source === "ai" && (
              <Badge tone="accent" className="gap-1">
                <Sparkles className="h-3 w-3" /> AI
              </Badge>
            )}
          </div>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            {whenLabel(a)}
            {a.repName && <span className="truncate">· {a.repName}</span>}
          </p>
        </div>
        <Badge tone={cfg.tone} className="shrink-0">
          {cfg.label}
        </Badge>
        <RowActions kind="appointment" id={a.id} leadId={a.leadId} statusOptions={APPT_STATUS_OPTIONS} />
      </div>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="Appointments"
        description="Account reviews scheduled across reps and the AI agent. Override an AI-set outcome or update status from the ⋯ menu."
      >
        {teamWide && (
          <Badge tone="primary" className="gap-1">
            <Users className="h-3 w-3" /> Team-wide
          </Badge>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total booked" value={String(appts.length)} icon={CalendarCheck} accent="primary" />
        <MetricCard label="Scheduled" value={String(scheduled.length)} icon={Clock} accent="accent" />
        <MetricCard label="Completed" value={String(completed)} icon={CalendarCheck} accent="success" />
        <MetricCard label="Show rate" value={`${showRate}%`} icon={CalendarX} accent="warning" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <h3 className="font-semibold">Upcoming</h3>
            <p className="text-xs text-muted-foreground">{scheduled.length} scheduled</p>
          </div>
          <div className="divide-y divide-border">
            {scheduled.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Nothing upcoming.</p>
            ) : (
              scheduled.map((a) => <Row key={a.id} a={a} />)
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <h3 className="font-semibold">All appointments</h3>
            <p className="text-xs text-muted-foreground">Most recent first</p>
          </div>
          <div className="divide-y divide-border">
            {appts.slice(0, 12).map((a) => (
              <Row key={a.id} a={a} />
            ))}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
