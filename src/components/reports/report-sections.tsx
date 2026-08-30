import { Bot, PhoneOutgoing, Users } from "lucide-react";
import { DrillLink } from "@/components/reports/drill-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { ChannelRow, DispositionRow, Funnel } from "@/lib/call-analytics";
import type { TeamLeaderboardRep } from "@/lib/db/metrics";
import { compareRanked } from "@/lib/leaderboard";
import { drillConnected, drillDialed, drillOutcome, drillRep } from "@/lib/reports/drill";
import { cn, formatDuration, formatNumber } from "@/lib/utils";

// Server (presentational) report sections — no hooks, safe in the server page.
// Drill-downs: every countable row links to /leads pre-filtered to (a leads-side
// approximation of) the rows behind it — see src/lib/reports/drill.ts. Passing
// rangeDays keeps the drilled set aligned with the page's active date range.

const ROLE_TONE: Record<string, "primary" | "accent" | "warning" | "neutral"> = {
  owner: "primary",
  admin: "accent",
  manager: "warning",
  rep: "neutral",
};

/** Dials → connects → appointments funnel with stage conversion rates. */
export function ReportFunnel({
  funnel,
  rangeDays = null,
}: {
  funnel: Funnel;
  /** The page's active range — drilled links carry the same window. */
  rangeDays?: number | null;
}) {
  const stages = [
    {
      label: "Dials",
      value: funnel.dials,
      width: 100,
      note: "total attempts",
      filter: drillDialed(rangeDays),
    },
    {
      label: "Connects",
      value: funnel.connects,
      width: funnel.dials ? Math.max(4, (funnel.connects / funnel.dials) * 100) : 0,
      note: `${funnel.connectRate}% of dials`,
      filter: drillConnected(rangeDays),
    },
    {
      label: "Appointments",
      value: funnel.appointments,
      width: funnel.dials ? Math.max(3, (funnel.appointments / funnel.dials) * 100) : 0,
      note: `${funnel.apptRate}% of connects`,
      filter: drillOutcome("appointment_booked", rangeDays),
    },
  ];
  return (
    <div className="space-y-3">
      {stages.map((s, i) => (
        <DrillLink key={s.label} filter={s.filter} className="rounded-lg">
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="tabular">
                <span className="font-bold">{formatNumber(s.value)}</span>{" "}
                <span className="text-xs text-muted-foreground">· {s.note}</span>
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  i === 0 ? "bg-primary/40" : i === 1 ? "bg-accent" : "bg-brand",
                )}
                style={{ width: `${s.width}%` }}
              />
            </div>
          </div>
        </DrillLink>
      ))}
    </div>
  );
}

/** Every disposition with a colored bar, count, and share — zeros included. */
export function DispositionBreakdown({
  dispositions,
  rangeDays = null,
}: {
  dispositions: DispositionRow[];
  rangeDays?: number | null;
}) {
  const max = Math.max(1, ...dispositions.map((d) => d.count));
  return (
    <div className="space-y-1">
      {dispositions.map((d) => (
        <DrillLink key={d.key} filter={drillOutcome(d.key, rangeDays)} className="rounded-lg">
          <div className="flex items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-muted/40">
            <span className="flex w-36 shrink-0 items-center gap-1.5 text-sm">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  d.connected ? "ring-2 ring-success/40" : "",
                )}
                style={{ background: d.color }}
              />
              <span className="truncate text-muted-foreground">{d.label}</span>
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${(d.count / max) * 100}%`, background: d.color }}
              />
            </div>
            <span className="w-14 text-right text-sm font-bold tabular">
              {formatNumber(d.count)}
            </span>
            <span className="w-12 text-right text-xs text-muted-foreground tabular">
              {d.rate}%
            </span>
          </div>
        </DrillLink>
      ))}
    </div>
  );
}

/** AI agent vs human reps comparison. */
export function ChannelCompare({ channelStats }: { channelStats: ChannelRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {channelStats.map((c) => {
        const isAI = c.channel === "ai";
        const Icon = isAI ? Bot : Users;
        return (
          <div key={c.channel} className="rounded-xl border border-border/60 bg-surface/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg",
                  isAI ? "bg-brand text-white" : "bg-accent-soft text-accent",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <p className="text-sm font-semibold">{c.label}</p>
              <span className="ml-auto text-xs text-muted-foreground tabular">
                {formatNumber(c.calls)} calls
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-muted/60 p-2">
                <p className="text-lg font-bold tabular">{c.connectRate}%</p>
                <p className="text-[11px] text-muted-foreground">Connect</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-2">
                <p className="text-lg font-bold tabular">{c.apptRate}%</p>
                <p className="text-[11px] text-muted-foreground">Appt rate</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-2">
                <p className="text-lg font-bold tabular">{formatNumber(c.appointments)}</p>
                <p className="text-[11px] text-muted-foreground">Appointments</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-2">
                <p className="text-lg font-bold tabular">
                  <PhoneOutgoing className="mr-1 inline h-3 w-3 text-muted-foreground" />
                  {formatDuration(c.avgTalkSec)}
                </p>
                <p className="text-[11px] text-muted-foreground">Avg talk</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Per-rep performance table (this calendar month), supervisors only. */
export function RepPerformance({ reps }: { reps: TeamLeaderboardRep[] }) {
  const ranked = [...reps]
    .sort((a, b) => compareRanked({ id: a.id, stat: a.monthly }, { id: b.id, stat: b.monthly }))
    .slice(0, 25);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2">#</th>
            <th className="px-4 py-2">Rep</th>
            <th className="px-4 py-2 text-right">Calls</th>
            <th className="px-4 py-2 text-right">Connect</th>
            <th className="px-4 py-2 text-right">Appts</th>
            <th className="px-4 py-2 text-right" title="Appointments booked, as a share of connected calls">
              Conv
            </th>
            <th className="px-4 py-2 text-right" title="Points from your org's leaderboard scoring">
              Points
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ranked.map((r, i) => (
            <tr key={r.id} className="transition-colors hover:bg-muted/40">
              <td className="px-4 py-2.5 text-muted-foreground tabular">{i + 1}</td>
              <td className="px-4 py-2.5">
                <DrillLink
                  filter={drillRep(r.id)}
                  className="rounded-lg"
                  label={`Opens ${r.name}'s assigned leads`}
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar initials={r.initials} color={r.avatarColor || undefined} seed={r.id} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.name}</p>
                      <Badge tone={ROLE_TONE[r.role] ?? "neutral"} className="capitalize">
                        {r.role}
                      </Badge>
                    </div>
                  </div>
                </DrillLink>
              </td>
              <td className="px-4 py-2.5 text-right font-bold tabular">{formatNumber(r.monthly.calls)}</td>
              <td className="px-4 py-2.5 text-right tabular">{r.monthly.connectRate}%</td>
              <td className="px-4 py-2.5 text-right font-bold tabular text-primary">
                {formatNumber(r.monthly.appointments)}
              </td>
              <td className="px-4 py-2.5 text-right tabular">{r.monthly.conversionRate}%</td>
              <td className="px-4 py-2.5 text-right">
                <Badge tone="success">{r.monthly.points}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
