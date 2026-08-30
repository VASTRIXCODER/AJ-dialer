import {
  AlarmClock,
  AlertTriangle,
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
import { cn, relativeTime } from "@/lib/utils";
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
          variant="page"
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
          variant="page"
          icon={Compass}
          title="No data yet"
          description="The command center lights up once the floor starts dialing."
        />
      </PageContainer>
    );
  }

  const { today, scanCapped, speedSampled, instancesCapped, queues, leaks, reps, playbooks } =
    data;
  // Capitalized here rather than via a vocabulary key: `appointmentNounPlural`
  // is the noun every workspace defines ("showings", "interviews"), and label
  // case is this surface's concern, not the vocabulary's.
  const ApptPlural =
    vocab.appointmentNounPlural.charAt(0).toUpperCase() +
    vocab.appointmentNounPlural.slice(1);
  // Each queue is `number | null`, and null means the read failed rather than
  // "none waiting". The doors below used to be gated on `count > 0`, which is
  // false for null — so a failed query removed the door silently and a broken
  // board looked like a clear one. Unknown queues now announce themselves.
  const attentionDoors = [
    {
      key: "overdue",
      count: queues.overdueCallbacks,
      href: "/callbacks",
      icon: AlarmClock,
      label: "overdue callbacks",
      tone: "danger" as const,
    },
    {
      key: "unscheduled",
      count: queues.unscheduledCallbacks,
      href: "/callbacks",
      icon: PhoneIncoming,
      label: "callbacks with no time set",
      tone: "neutral" as const,
    },
    {
      key: "untouched",
      count: queues.untouchedNew,
      href: "/leads",
      icon: Users,
      label: `untouched new ${vocab.leadNounPlural}`,
      tone: "warning" as const,
    },
    {
      key: "hot",
      count: queues.hotSignals,
      href: "/dashboard",
      icon: Flame,
      label: "hot signals open",
      tone: "danger" as const,
    },
  ];
  const openDoors = attentionDoors.filter((d) => d.count !== null && d.count > 0);
  const unknownDoors = attentionDoors.filter((d) => d.count === null);

  /** A count the tile can render, or null so it shows an em dash. */
  const n = (v: number | null) => (v === null ? null : String(v));
  const UNREAD = "Couldn't read this count — it is not necessarily zero.";

  return (
    <PageContainer>
      <PageHeader
        title="Command Center"
        description="Whole org · live. What happened today, what needs attention, and where the pipeline leaks."
      />

      {/* Today strip — org scope, org-time today. */}
      <div>
        {/* The window and the scope were stated once, here, so every tile
            below had an empty caption line. Each one says it for itself now. */}
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Today so far
        </p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Dials"
            value={n(today.dials)}
            unavailable={UNREAD}
            definitionKey="calls_today"
            window="today"
            scope="org"
            icon={Phone}
            accent="accent"
          />
          <MetricCard
            label="Conversations"
            value={n(today.conversations)}
            unavailable={UNREAD}
            definitionKey="human_connects"
            window="today"
            scope="org"
            icon={PhoneCall}
            accent="success"
          />
          <MetricCard
            // Counts call dispositions, not rows in the appointments table.
            // The dashboard's tile of the same name counts the other thing;
            // they are different numbers and now carry different definitions.
            label={`${ApptPlural} booked`}
            value={n(today.appointments)}
            unavailable={UNREAD}
            definitionKey="appointment_outcomes"
            window="today"
            scope="org"
            icon={CalendarCheck}
            accent="warning"
          />
          <MetricCard
            label={`${vocab.LeadNounPlural} worked`}
            value={`${scanCapped ? "≥" : ""}${today.leadsWorked}`}
            definitionKey="leads_worked"
            window="today"
            scope="org"
            windowDetail={scanCapped ? "at least — capped scan" : undefined}
            icon={Users}
            accent="accent"
          />
          <MetricCard
            label={`New ${vocab.leadNounPlural}`}
            value={n(today.newLeads)}
            unavailable={UNREAD}
            // Unkeyed on purpose: a single-screen operational count. "New"
            // here means every lead row created today, however it arrived —
            // an import of 5,000 counts as 5,000 — which is not what the
            // phrase suggests, so the caption says it rather than a glossary
            // entry implying it was reconciled with anything.
            windowDetail="every lead row created today"
            window="today"
            scope="org"
            icon={Sparkles}
            accent="accent"
          />
          <MetricCard
            label="Speed to first call"
            // null, not a dash. A dash keeps `value` truthy, so the card takes
            // its has-a-number path and `unavailable` — the line that says WHY
            // there is nothing to show — can never render.
            value={today.speedToLeadMin != null ? `${today.speedToLeadMin}m` : null}
            unavailable="Not enough first attempts today to take a median"
            definitionKey="speed_to_first_call"
            window="today"
            scope="org"
            windowDetail={speedSampled ? "median of the first 1,000" : "median"}
            icon={Timer}
            accent={today.speedToLeadMin != null && today.speedToLeadMin > 60 ? "danger" : "success"}
          />
        </div>
      </div>

      {/* Attention queues — each count is a door, not a decoration. A queue
          that could not be READ announces itself instead of disappearing:
          these used to be gated on `count > 0`, which is false for null, so a
          failed query silently removed the door and a broken board looked
          like a clear one. */}
      {(openDoors.length > 0 || unknownDoors.length > 0) && (
        <SectionCard
          title="Needs attention now"
          description="Open queues across the whole org · live"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {openDoors.map((d) => {
              const Icon = d.icon;
              return (
                <Link
                  key={d.key}
                  href={d.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-3 transition-colors",
                    d.tone === "danger" && "border-danger/30 bg-danger/5 hover:bg-danger/10",
                    d.tone === "warning" && "border-warning/30 bg-warning/5 hover:bg-warning/10",
                    d.tone === "neutral" && "border-border/70 bg-muted/30 hover:bg-muted/60",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5 shrink-0",
                      d.tone === "danger" && "text-danger",
                      d.tone === "warning" && "text-warning",
                      d.tone === "neutral" && "text-muted-foreground",
                    )}
                  />
                  <span>
                    <span
                      className={cn(
                        "block text-lg font-bold tabular",
                        d.tone === "danger" && "text-danger",
                        d.tone === "warning" && "text-warning",
                      )}
                    >
                      {d.count}
                    </span>
                    <span className="block text-xs text-muted-foreground">{d.label}</span>
                  </span>
                </Link>
              );
            })}
            {unknownDoors.map((d) => (
              <div
                key={d.key}
                className="flex items-center gap-3 rounded-xl border border-signal-ring/30 bg-signal-ring-bg p-3"
                title="This count could not be read. It is not necessarily zero."
              >
                <AlertTriangle className="h-5 w-5 shrink-0 text-signal-ring" />
                <span>
                  <span className="block text-lg font-bold tabular text-ink-3">—</span>
                  <span className="block text-xs text-muted-foreground">
                    couldn&apos;t read {d.label}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Pipeline leaks — the §5 detector: open, no future next action, no
          live work item. The one list that catches "nothing is happening". */}
      {leaks.count > 0 && (
        <SectionCard
          title={`Pipeline leaks · ${leaks.count} open`}
          description={`Worked at least once, then stalled: no next action scheduled and no task holding them. Never-called ${vocab.leadNounPlural} are the untouched queue above, not a leak.`}
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
        <SectionCard
          title="Floor today"
          description={
            scanCapped
              ? "Per rep · today · org time · from the first 12,000 calls today"
              : "Per rep · today · org time"
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-bold">Rep</th>
                  <th className="py-2 pr-3 text-right font-bold">Dials</th>
                  <th className="py-2 pr-3 text-right font-bold">Conversations</th>
                  <th className="py-2 text-right font-bold">
                    {ApptPlural}
                  </th>
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
                  v{pb.version} · {instancesCapped ? "≥" : ""}
                  {pb.activeInstances} running
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </PageContainer>
  );
}
