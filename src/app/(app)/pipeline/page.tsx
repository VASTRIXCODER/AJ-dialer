import {
  CalendarCheck,
  CalendarX2,
  CheckCircle2,
  CircleSlash,
  Flame,
  Gauge,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  ShieldQuestion,
  Timer,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState, InlineEmpty } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { getKingPipeline, type ChannelHealth, type StripCard } from "@/lib/db/king-pipeline";
import { orgTimezone } from "@/lib/metrics/definitions";
import { STAGE_LABELS } from "@/lib/opportunities/why-now";
import { getViewer } from "@/lib/org/membership";
import { orgVocabulary } from "@/lib/org/vocabulary";
import { cn, relativeTime } from "@/lib/utils";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

/** One icon per glossary id, so the strip reads at a glance. */
const STRIP_ICONS = {
  leads_worked: Users,
  calls_today: Phone,
  contacts_made: PhoneCall,
  appointments_set: CalendarCheck,
  appointments_confirmed: CheckCircle2,
  appointments_at_risk: ShieldQuestion,
  no_shows: CalendarX2,
  no_show_recovered: CircleSlash,
  sales_closed: CircleSlash,
  installs_completed: CircleSlash,
  hot_opportunities: Flame,
  speed_to_lead: Timer,
  followup_completion: Gauge,
} as const;

const STRIP_ACCENTS = {
  leads_worked: "accent",
  calls_today: "accent",
  contacts_made: "success",
  appointments_set: "warning",
  no_shows: "danger",
  hot_opportunities: "danger",
  speed_to_lead: "primary",
} as const;

const CHANNEL_ICONS = { playbooks: Workflow, email: Mail, sms: MessageSquare } as const;

const CHANNEL_TONE: Record<ChannelHealth["state"], { badge: string; ring: string; word: string }> =
  {
    live: { badge: "success", ring: "border-success/30 bg-success/5", word: "Running" },
    idle: { badge: "neutral", ring: "border-border/70 bg-muted/20", word: "Idle" },
    blocked: { badge: "warning", ring: "border-warning/30 bg-warning/5", word: "Not running" },
    off: { badge: "danger", ring: "border-danger/30 bg-danger/5", word: "Switched off" },
  };

const SEVERITY_TONE = {
  critical: "border-danger/30 bg-danger/5 hover:bg-danger/10",
  high: "border-warning/30 bg-warning/5 hover:bg-warning/10",
  normal: "border-border/70 bg-muted/20 hover:bg-muted/40",
} as const;

/**
 * King's pipeline — one operating view (docs/phase_two.md §17).
 *
 * "King must not dig through ten screens." Today's production, the follow-up
 * automation that runs without a rep, where the pipeline is leaking, and who is
 * doing what — on one page, each number carrying its own definition, window and
 * scope.
 *
 * Read-only by design. Every queue is a door into the screen that already owns
 * that work; this page never becomes a second place to do it.
 */
export default async function PipelinePage() {
  const viewer = await getViewer();
  const vocab = orgVocabulary(viewer.org);

  if (!viewer.permissions.includes("reports.view")) {
    return (
      <PageContainer>
        <PageHeader title="Pipeline" description="The whole operation, on one page." />
        <EmptyState
          icon={Workflow}
          title="Reports access required"
          description="Ask an admin for the reports permission to see the pipeline view."
        />
      </PageContainer>
    );
  }

  if (!viewer.org) {
    return (
      <PageContainer>
        <PageHeader title="Pipeline" description="The whole operation, on one page." />
        <EmptyState
          icon={Workflow}
          title="Join a workspace first"
          description="The pipeline view is org-wide, so it needs a workspace to report on."
        />
      </PageContainer>
    );
  }

  const tz = orgTimezone(viewer.org);
  const data = await getKingPipeline({ orgId: viewer.org.id, orgTz: tz, org: viewer.org });

  // The strip splits in two on purpose. Scattering five permanent em dashes
  // through the working numbers makes the page look broken; grouping them makes
  // the GAP legible — these are not missing readings, they are metrics this
  // deployment has no fact to compute, and that is a decision King should see.
  const measured = data.strip.filter((c) => !isStructural(c));
  const unmeasurable = data.strip.filter(isStructural);
  const liveLeaks = data.leaks.filter((l) => l.count === null || l.count > 0);

  return (
    <PageContainer>
      <PageHeader
        title="Pipeline"
        // Kept to one line at 1440px on purpose: PageHeader centres its actions
        // against the title block, so a description that wraps drops the
        // freshness badge to sit beside the second line instead of the title.
        description="Whole org · today's production, the automation, and the leaks."
      >
        <Badge tone="neutral" className="gap-1.5">
          <Timer className="h-3 w-3" />
          {relativeTime(data.generatedAt)} · {tz}
        </Badge>
      </PageHeader>

      {data.degraded && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
          The org-wide read failed, so today&rsquo;s numbers below could not be computed. This is
          not a quiet day — it is a missing reading.
        </div>
      )}

      {/* ── Today ─────────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Today · whole org · {tz}
        </p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-4">
          {measured.map((card) => {
            const tile = (
              <MetricCard
                label={card.label}
                value={card.value === null ? null : formatValue(card)}
                unavailable={card.unavailable}
                sub={card.value === null ? undefined : card.sub}
                definitionKey={card.id}
                icon={STRIP_ICONS[card.id as keyof typeof STRIP_ICONS] ?? Gauge}
                accent={
                  (STRIP_ACCENTS[card.id as keyof typeof STRIP_ACCENTS] ?? "primary") as
                    | "primary"
                    | "accent"
                    | "success"
                    | "warning"
                    | "danger"
                }
              />
            );
            // §17: every card drills down. Cards without a destination stay
            // plain rather than pretending to be clickable.
            return card.href ? (
              <Link
                key={card.id}
                href={card.href}
                className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tile}
              </Link>
            ) : (
              <div key={card.id}>{tile}</div>
            );
          })}
        </div>
      </div>

      {/* ── What the automation is doing ──────────────────────────────────── */}
      {/* Collapses when there is nothing to report — a titled card with an
          empty box inside it is the shape of a screen that is still being
          built, and this one is finished. */}
      {data.channels.length > 0 && (
      <SectionCard
        title="Follow-up automation"
        description="What runs without a rep touching it — and what does not."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {data.channels.map((ch) => {
            const Icon = CHANNEL_ICONS[ch.key];
            const tone = CHANNEL_TONE[ch.state];
            return (
              <div
                key={ch.key}
                className={cn("flex flex-col gap-3 rounded-xl border p-4", tone.ring)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-semibold">{ch.label}</span>
                  </span>
                  <Badge
                    tone={tone.badge as "success" | "neutral" | "warning" | "danger"}
                    className="shrink-0"
                  >
                    {tone.word}
                  </Badge>
                </div>

                <p className="text-xs leading-relaxed text-muted-foreground">{ch.detail}</p>

                {ch.facts && ch.facts.length > 0 && (
                  <dl className="space-y-1">
                    {ch.facts.map((f) => (
                      <div key={f.label} className="flex items-baseline justify-between gap-2">
                        <dt className="shrink-0 text-[11px] text-muted-foreground">{f.label}</dt>
                        <dd className="min-w-0 truncate text-[11px] font-semibold tabular">
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-muted-foreground">
                    {ch.lastTickAt
                      ? `Last ran ${relativeTime(ch.lastTickAt)}`
                      : ch.key === "playbooks" || ch.key === "sms"
                        ? "Never run"
                        : ""}
                  </span>
                  {ch.action && ch.href && (
                    <Link
                      href={ch.href}
                      className="shrink-0 text-[11px] font-semibold text-primary hover:underline"
                    >
                      {ch.action}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
      )}

      {/* ── Pipeline leaks ────────────────────────────────────────────────── */}
      {liveLeaks.length > 0 && (
        <SectionCard
          title="Where the pipeline is leaking"
          description="Each one is a door. Ordered by how much it costs to ignore."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {liveLeaks.map((leak) => (
              <Link
                key={leak.key}
                href={leak.href}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-4 transition-colors",
                  SEVERITY_TONE[leak.severity],
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold">{leak.label}</span>
                  <span className="shrink-0 text-xl font-bold tabular">
                    {leak.count === null ? "—" : leak.count}
                  </span>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {leak.count === null
                    ? (leak.unavailable ?? "Couldn't read this count.")
                    : leak.action}
                </span>
              </Link>
            ))}
          </div>

          {data.leakSample.length > 0 && (
            <ul className="mt-4 space-y-2 border-t border-border/60 pt-4">
              {data.leakSample.map((leak) => (
                <li key={leak.id} className="flex items-center gap-2.5 text-sm">
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
          )}
        </SectionCard>
      )}

      {/* ── Rep performance ───────────────────────────────────────────────── */}
      {data.reps.length > 0 && (
        <SectionCard
          title="The floor today"
          description={`Per rep · ${tz} today${data.repsCapped ? " · at least, on a capped scan" : ""}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Rep</th>
                  <th className="px-5 py-3 text-right font-medium">Dials</th>
                  <th className="px-5 py-3 text-right font-medium">Contacts</th>
                  <th className="px-5 py-3 text-right font-medium">
                    {vocab.appointmentNounPlural}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.reps.map((rep) => (
                  <tr key={rep.id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-3 font-medium">{rep.name}</td>
                    <td className="px-5 py-3 text-right tabular">{rep.dials}</td>
                    <td className="px-5 py-3 text-right tabular">{rep.conversations}</td>
                    <td className="px-5 py-3 text-right tabular">{rep.appointments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Playbook oversight ────────────────────────────────────────────── */}
      {data.playbooks.length > 0 && (
        <SectionCard
          title="Playbooks"
          description="What is published, and how much is running through it right now."
        >
          <ul className="space-y-2">
            {data.playbooks.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 text-sm">
                <Workflow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <Badge tone={p.status === "published" ? "success" : "neutral"} className="shrink-0">
                  {p.status}
                </Badge>
                <span className="shrink-0 text-xs text-muted-foreground tabular">
                  v{p.version}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular">
                  {data.instancesCapped ? "≥" : ""}
                  {p.activeInstances} running
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* ── What this view cannot tell you ────────────────────────────────── */}
      {unmeasurable.length > 0 && (
        <SectionCard
          title="Not measurable in this workspace"
          description="§17 asks for these. Each one needs a fact this deployment does not have — so the tile is blank rather than zero."
        >
          <dl className="grid gap-3 sm:grid-cols-2">
            {unmeasurable.map((card) => (
              <InlineEmpty key={card.id} size="tight" align="left" className="block text-left">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {card.label}
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {card.unavailable}
                </dd>
              </InlineEmpty>
            ))}
          </dl>
        </SectionCard>
      )}
    </PageContainer>
  );
}

/**
 * A card that can NEVER be computed here, as opposed to one that merely failed
 * to read this time. The difference decides which half of the page it lands in:
 * a failed read belongs beside the working numbers (it will be back tomorrow),
 * a structural gap belongs in its own section with an explanation.
 */
function isStructural(card: StripCard): boolean {
  return (
    card.value === null &&
    card.unavailable !== undefined &&
    !card.unavailable.startsWith("Couldn't read") &&
    !card.unavailable.startsWith("Not enough")
  );
}

/** Speed-to-lead is minutes; everything else in the strip is a plain count. */
function formatValue(card: StripCard): string {
  if (card.value === null) return "—";
  if (card.id === "speed_to_lead") return `${card.value}m`;
  return `${card.capped ? "≥" : ""}${card.value.toLocaleString()}`;
}
