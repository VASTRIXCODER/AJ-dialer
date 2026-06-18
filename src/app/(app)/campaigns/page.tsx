import { CalendarCheck, Megaphone, Pause, Play, Plus, Users } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { campaigns } from "@/lib/data";
import { formatNumber, formatPercent } from "@/lib/utils";

export const metadata = { title: "Campaigns" };

const statusTone = {
  active: { tone: "success" as const, label: "Active" },
  paused: { tone: "warning" as const, label: "Paused" },
  completed: { tone: "neutral" as const, label: "Completed" },
};

export default function CampaignsPage() {
  const totalLeads = campaigns.reduce((a, c) => a + c.totalLeads, 0);
  const totalAppts = campaigns.reduce((a, c) => a + c.appointments, 0);
  const active = campaigns.filter((c) => c.status === "active").length;

  return (
    <PageContainer>
      <PageHeader
        title="Campaigns"
        description="Organize outreach by utility provider, territory, and resolution play."
      >
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New campaign
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Active campaigns" value={String(active)} icon={Megaphone} accent="primary" />
        <MetricCard label="Total leads" value={formatNumber(totalLeads)} icon={Users} accent="accent" />
        <MetricCard label="Appointments" value={formatNumber(totalAppts)} icon={CalendarCheck} accent="success" />
        <MetricCard label="Avg contact rate" value="31%" icon={Play} accent="warning" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {campaigns.map((c) => {
          const progress = Math.round((c.completedLeads / c.totalLeads) * 100);
          const cfg = statusTone[c.status];
          return (
            <Card key={c.id} className="group flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">
              <div className="h-1.5 w-full" style={{ background: c.color }} />
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold leading-tight">{c.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.utilityProvider}
                    </p>
                  </div>
                  <Badge tone={cfg.tone} dot>
                    {cfg.label}
                  </Badge>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Active leads</p>
                    <p className="text-xl font-bold tabular">{formatNumber(c.activeLeads)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Appointments</p>
                    <p className="text-xl font-bold tabular text-primary">{c.appointments}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-semibold tabular">{progress}%</span>
                  </div>
                  <Progress value={progress} barClassName="" />
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(c.completedLeads)} of {formatNumber(c.totalLeads)} leads ·{" "}
                    {formatPercent(c.contactRate)} contact rate
                  </p>
                </div>

                <div className="mt-5 flex gap-2 border-t border-border pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5"
                  >
                    {c.status === "active" ? (
                      <>
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" /> Resume
                      </>
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1">
                    Details
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </PageContainer>
  );
}
