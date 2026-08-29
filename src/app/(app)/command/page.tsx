import {
  AlarmClock,
  CalendarCheck,
  Compass,
  Droplets,
  Flame,
  Phone,
  PhoneCall,
  PhoneIncoming,
  Sparkles,
  Timer,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { ReactivationStudio } from "@/components/command/reactivation-studio";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/shared/section-card";
import { getCommandCenter } from "@/lib/db/command-center";
import { orgTimezone } from "@/lib/metrics/definitions";
import { getViewer } from "@/lib/org/membership";
import { orgVocabulary } from "@/lib/org/vocabulary";
import { relativeTime } from "@/lib/utils";
import { STAGE_LABELS } from "@/lib/opportunities/why-now";

export const metadata = { title: "Command Center" };
export const dynamic = "force-dynamic";

/**
 * Command Center (P2.10): the supervisor cockpit. Four ideas, in rank order:
 * what happened today, what needs attention NOW, where the pipeline is
 * leaking, and who on the floor is doing what. Every number states its scope
 * and window; ratios below their denominator floor say "not enough data";
 * empty panels collapse. Read-only — every queue links to its working page.
 */
export default async function CommandCenterPage() {
  const viewer = await getViewer();
  const vocab = orgVocabulary(viewer.org);
  if (!viewer.permissions.includes("reports.view")) {
    return (
      <PageContainer>
        <PageHeader title="Command Center" description="The org-wide floor view." />
        <EmptyState
          icon={Compass}
          title="Reports access required"
          description="Ask an admin for the reports permission to see the floor view."
        />
      </PageContainer>
    );
  }

  const data = viewer.org
    ? await getCommandCenter({ orgId: viewer.org.id, orgTz: orgTimezone(viewer.org) })
    : null;

  if (!data) {
    return (
      <PageContainer>
        <PageHeader title="Command Center" description="The org-wide floor view." />
        <EmptyState
          icon={Compass}
          title="No data yet"
          description="The command center lights up once the floor starts dialing."
        />
      </PageContainer>
    );
  }

  const { today, queues, leaks, reps, playbooks } = data;
  const attentionTotal =
    queues.overdueCallbacks +
    queues.unscheduledCallbacks +
    queues.untouchedNew +
    queues.hotSignals;

  return (
    <PageContainer>
      <PageHeader
        title="Command Center"
        description="Whole org · live. What happened today, what needs attention, and where the pipeline leaks."
      />

      {/* Today strip — org scope, org-time today. */}
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Today · whole org · org time
        </p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Dials" value={String(today.dials)} icon={Phone} accent="accent" />
          <MetricCard
            label="Conversations"
            value={String(today.conversations)}
            icon={PhoneCall}
            accent="success"
          />
          <MetricCard
            label="Appointments"
            value={String(today.appointments)}
            icon={CalendarCheck}
            accent="warning"
          />
          <MetricCard
            label={`${vocab.LeadNounPlural} worked`}
            value={String(today.leadsWorked)}
            icon={Users}
            accent="accent"
          />
          <MetricCard
            label={`New ${vocab.leadNounPlural}`}
            value={String(today.newLeads)}
            icon={Sparkles}
            accent="accent"
          />
          <MetricCard
            label="Speed to first call"
            value={today.speedToLeadMin != null ? `${today.speedToLeadMin}m` : "—"}
            sub={
              today.speedToLeadMin != null
                ? "median · first attempts today"
                : "not enough data today"
            }
            icon={Timer}
            accent={today.speedToLeadMin != null && today.speedToLeadMin > 60 ? "danger" : "success"}
          />
        </div>
      </div>

      {/* Attention queues — each count is a door, not a decoration. */}
      {attentionTotal > 0 && (
        <SectionCard
          title="Needs attention now"
          description="Open queues across the whole org · live"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {queues.overdueCallbacks > 0 && (
              <Link
                href="/callbacks"
                className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3 transition-colors hover:bg-danger/10"
              >
                <AlarmClock className="h-5 w-5 shrink-0 text-danger" />
                <span>
                  <span className="block text-lg font-bold tabular text-danger">
                    {queues.overdueCallbacks}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    overdue callbacks
                  </span>
                </span>
              </Link>
            )}
            {queues.unscheduledCallbacks > 0 && (
              <Link
                href="/callbacks"
                className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3 transition-colors hover:bg-muted/60"
              >
                <PhoneIncoming className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-lg font-bold tabular">
                    {queues.unscheduledCallbacks}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    callbacks with no time set
                  </span>
                </span>
              </Link>
            )}
            {queues.untouchedNew > 0 && (
              <Link
                href="/leads"
                className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3 transition-colors hover:bg-warning/10"
              >
                <Users className="h-5 w-5 shrink-0 text-warning" />
                <span>
                  <span className="block text-lg font-bold tabular text-warning">
                    {queues.untouchedNew}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    untouched new {vocab.leadNounPlural}
                  </span>
                </span>
              </Link>
            )}
            {queues.hotSignals > 0 && (
              <Link
                href="/dashboard"
                className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3 transition-colors hover:bg-danger/10"
              >
                <Flame className="h-5 w-5 shrink-0 text-danger" />
                <span>
                  <span className="block text-lg font-bold tabular text-danger">
                    {queues.hotSignals}
                  </span>
                  <span className="block text-xs text-muted-foreground">hot signals open</span>
                </span>
              </Link>
            )}
          </div>
        </SectionCard>
      )}

      {/* Pipeline leaks — the §5 detector: open, no future next action, no
          live work item. The one list that catches "nothing is happening". */}
      {leaks.count > 0 && (
        <SectionCard
          title={`Pipeline leaks · ${leaks.count} open`}
          description={`Open ${vocab.leadNounPlural} with no next action scheduled and no task holding them — whole org, right now`}
        >
          <ul className="space-y-2">
            {leaks.sample.map((leak) => (
              <li key={leak.id} className="flex items-center gap-2.5 text-sm">
                <Droplets className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{leak.leadName}</span>
                <Badge tone="neutral" className="shrink-0">
                  {STAGE_LABELS[leak.stage] ?? leak.stage}
                </Badge>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  {leak.ownerName}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular">
                  {leak.lastTouchedAt ? relativeTime(leak.lastTouchedAt) : "never touched"}
                </span>
              </li>
            ))}
          </ul>
          {leaks.count > leaks.sample.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing {leaks.sample.length} of {leaks.count}. Playbooks and assignments are
              how leaks get owners.
            </p>
          )}
        </SectionCard>
      )}

      {/* Rep performance — today, org time. A table, not a podium. */}
      {reps.length > 0 && (
        <SectionCard title="Floor today" description="Per rep · today · org time">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-bold">Rep</th>
                  <th className="py-2 pr-3 text-right font-bold">Dials</th>
                  <th className="py-2 pr-3 text-right font-bold">Conversations</th>
                  <th className="py-2 text-right font-bold">Appointments</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((rep) => (
                  <tr key={rep.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-3 font-medium">{rep.name}</td>
                    <td className="py-2 pr-3 text-right tabular">{rep.dials}</td>
                    <td className="py-2 pr-3 text-right tabular">{rep.conversations}</td>
                    <td className="py-2 text-right tabular">{rep.appointments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Reactivation studio (P2.9): aged cohorts → strict dial sessions. */}
      <ReactivationStudio />

      {/* Playbooks at a glance. */}
      {playbooks.length > 0 && (
        <SectionCard
          title="Playbooks"
          description="Automated follow-through · live instance counts"
          action={
            viewer.permissions.includes("org.edit")
              ? { label: "Manage in Admin", href: "/admin" }
              : undefined
          }
        >
          <ul className="space-y-2">
            {playbooks.map((pb) => (
              <li key={pb.id} className="flex items-center gap-2.5 text-sm">
                <Workflow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{pb.name}</span>
                <Badge
                  tone={
                    pb.status === "published"
                      ? "success"
                      : pb.status === "paused"
                        ? "warning"
                        : "neutral"
                  }
                  className="shrink-0 capitalize"
                >
                  {pb.status}
                </Badge>
                <span className="shrink-0 text-xs text-muted-foreground tabular">
                  v{pb.version} · {pb.activeInstances} running
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </PageContainer>
  );
}
