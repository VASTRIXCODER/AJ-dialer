import { AlarmClock, CheckCircle2, Clock, PhoneCall } from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { callbacks } from "@/lib/data";
import type { Callback } from "@/lib/types";
import { formatPhone, initials, relativeTime } from "@/lib/utils";

export const metadata = { title: "Callbacks" };

const groups: Array<{
  key: Callback["status"];
  title: string;
  tone: "danger" | "warning" | "accent";
  icon: typeof AlarmClock;
}> = [
  { key: "overdue", title: "Overdue", tone: "danger", icon: AlarmClock },
  { key: "due", title: "Due now", tone: "warning", icon: Clock },
  { key: "upcoming", title: "Upcoming", tone: "accent", icon: CheckCircle2 },
];

export default function CallbacksPage() {
  const overdue = callbacks.filter((c) => c.status === "overdue").length;

  return (
    <PageContainer>
      <PageHeader
        title="Callbacks"
        description="Every promised callback, tracked so nothing slips through the cracks."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Overdue" value={String(overdue)} icon={AlarmClock} accent="danger" />
        <MetricCard label="Due today" value={String(callbacks.filter((c) => c.status === "due").length + 7)} icon={Clock} accent="warning" />
        <MetricCard label="Upcoming" value={String(callbacks.filter((c) => c.status === "upcoming").length + 14)} icon={CheckCircle2} accent="accent" />
        <MetricCard label="Completion" value="92%" icon={PhoneCall} accent="success" delta={{ value: "3%", positive: true }} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {groups.map((group) => {
          const items = callbacks.filter((c) => c.status === group.key);
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
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    Nothing here. 🎉
                  </p>
                )}
                {items.map((cb) => (
                  <div key={cb.id} className="p-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={initials(cb.leadName)} color="#F97316" size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{cb.leadName}</p>
                        <p className="truncate text-xs text-muted-foreground tabular">
                          {formatPhone(cb.phone)}
                        </p>
                      </div>
                      <span
                        className={
                          group.tone === "danger"
                            ? "text-xs font-semibold text-danger"
                            : "text-xs font-medium text-muted-foreground"
                        }
                      >
                        {relativeTime(cb.dueAt)}
                      </span>
                    </div>
                    <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                      {cb.reason}
                    </p>
                    <Link
                      href="/dialer"
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
