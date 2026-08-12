import { AlarmClock, CheckCircle2, Clock, PhoneCall, PhoneIncoming, Users } from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RowActions } from "@/components/pipeline/row-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCallbacks, type CallbackRow } from "@/lib/db/pipeline";
import { formatPhone, initials, relativeTime } from "@/lib/utils";

export const metadata = { title: "Callbacks" };
export const dynamic = "force-dynamic";

const CB_STATUS_OPTIONS = [
  { value: "completed", label: "Mark done" },
  { value: "cancelled", label: "Cancel" },
  { value: "due", label: "Re-open" },
];

const groups: Array<{
  key: "overdue" | "due" | "upcoming";
  title: string;
  tone: "danger" | "warning" | "accent";
  icon: typeof AlarmClock;
}> = [
  { key: "overdue", title: "Overdue", tone: "danger", icon: AlarmClock },
  { key: "due", title: "Due now", tone: "warning", icon: Clock },
  { key: "upcoming", title: "Upcoming", tone: "accent", icon: CheckCircle2 },
];

function groupOf(c: CallbackRow): "overdue" | "due" | "upcoming" {
  if (!c.dueAt) return "due";
  const t = new Date(c.dueAt).getTime();
  if (t < Date.now() - 60_000) return "overdue";
  if (t > Date.now() + 60_000) return "upcoming";
  return "due";
}

export default async function CallbacksPage() {
  const callbacks = await getCallbacks();

  if (callbacks.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Callbacks"
          description="Every promised callback, tracked so nothing slips through the cracks."
        />
        <EmptyState
          icon={PhoneIncoming}
          title="No callbacks scheduled"
          description="Promised callbacks from your reps and the AI agent are tracked here automatically."
        />
      </PageContainer>
    );
  }

  const teamWide = callbacks[0]?.teamWide;
  const active = callbacks.filter((c) => c.status !== "completed" && c.status !== "cancelled");
  const completed = callbacks.filter((c) => c.status === "completed").length;
  const count = (k: string) => active.filter((c) => groupOf(c) === k).length;

  return (
    <PageContainer>
      <PageHeader
        title="Callbacks"
        description="Every promised callback, tracked so nothing slips through the cracks. Re-disposition or close one from the ⋯ menu."
      >
        {teamWide && (
          <Badge tone="primary" className="gap-1">
            <Users className="h-3 w-3" /> Team-wide
          </Badge>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Overdue" value={String(count("overdue"))} icon={AlarmClock} accent="danger" />
        <MetricCard label="Due now" value={String(count("due"))} icon={Clock} accent="warning" />
        <MetricCard label="Upcoming" value={String(count("upcoming"))} icon={CheckCircle2} accent="accent" />
        <MetricCard label="Completed" value={String(completed)} icon={PhoneCall} accent="success" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {groups.map((group) => {
          const items = active.filter((c) => groupOf(c) === group.key);
          const Icon = group.icon;
          return (
            <Card key={group.key} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border p-4">
                <div className="flex items-center gap-2">
                  <Icon
                    className={
                      group.tone === "danger"
                        ? "h-4 w-4 text-danger"
                        : group.tone === "warning"
                          ? "h-4 w-4 text-warning"
                          : "h-4 w-4 text-accent"
                    }
                  />
                  <h3 className="font-semibold">{group.title}</h3>
                </div>
                <Badge tone={group.tone}>{items.length}</Badge>
              </div>
              <div className="divide-y divide-border">
                {items.length === 0 && (
                  <p className="p-6 text-center text-sm text-muted-foreground">Nothing here. 🎉</p>
                )}
                {items.map((cb) => (
                  <div key={cb.id} className="p-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={initials(cb.leadName)} tone="chart-1" size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{cb.leadName}</p>
                        <p className="truncate text-xs text-muted-foreground tabular">
                          {cb.phone ? formatPhone(cb.phone) : "—"}
                          {cb.repName && <span> · {cb.repName}</span>}
                        </p>
                      </div>
                      {cb.dueAt && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {relativeTime(cb.dueAt)}
                        </span>
                      )}
                      <RowActions kind="callback" id={cb.id} leadId={cb.leadId} statusOptions={CB_STATUS_OPTIONS} />
                    </div>
                    {cb.reason && (
                      <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                        {cb.reason}
                      </p>
                    )}
                    <Link
                      href={
                        cb.phone
                          ? `/dialer?dial=${encodeURIComponent(cb.phone)}&name=${encodeURIComponent(cb.leadName)}`
                          : "/dialer"
                      }
                      className={buttonVariants({
                        size: "sm",
                        variant: group.key === "overdue" ? "primary" : "outline",
                        className: "mt-2.5 w-full gap-1.5",
                      })}
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                      Call back
                    </Link>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </PageContainer>
  );
}
