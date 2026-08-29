import {
  AlarmClock,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Flame,
  Phone,
  PhoneCall,
  PhoneIncoming,
  Sunrise,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { floatingRelativeTime } from "@/lib/appointments/time";
import { dialDeepLink } from "@/lib/dialer/deep-link";
import { getMyDay, type MyDayData } from "@/lib/db/my-day";
import { getScope } from "@/lib/db/scope";
import { orgTimezone } from "@/lib/metrics/definitions";
import { getViewer } from "@/lib/org/membership";
import { orgVocabulary } from "@/lib/org/vocabulary";
import { formatDuration, formatPhone, relativeTime } from "@/lib/utils";

export const metadata = { title: "My Day" };
export const dynamic = "force-dynamic";

/**
 * My Day (P2.6): the rep's "what should I do right now" — a deterministic
 * who-next recommendation (never DNC / archived / number-less / out-of-window /
 * held-by-someone-else), the work waiting on them, today's appointments, and
 * an honest end-of-day readout. Personal by design: supervisors get the org
 * view on the Command Center.
 *
 * Every number carries its scope ("You · today"); empty panels collapse
 * instead of reserving space; the page has exactly one primary action.
 */
export default async function TodayPage() {
  const [viewer, scope] = await Promise.all([getViewer(), getScope()]);
  const vocab = orgVocabulary(viewer.org);
  const data: MyDayData | null = scope
    ? await getMyDay({
        scope,
        hours: viewer.org?.settings.hours ?? null,
        orgTz: orgTimezone(viewer.org),
      })
    : null;

  if (!data) {
    return (
      <PageContainer>
        <PageHeader
          title="My Day"
          description="Your working queue for today — callbacks, tasks, signals and appointments in one place."
        />
        <EmptyState
          icon={Sunrise}
          title="Nothing queued yet"
          description={`Load ${vocab.leadNounPlural} into the dialer to start building your day.`}
        />
      </PageContainer>
    );
  }

  const {
    callbacks,
    workItems,
    signals,
    appointmentsToday,
    today,
    assignments,
    whoNext,
    nowFloating,
  } = data;
  // Only link to destinations this workspace actually has turned on — a link
  // into a disabled feature is a dead end, not a shortcut.
  const features = viewer.org?.settings.features;
  const canOpenCallbacks = features?.callbacks !== false;
  const canOpenAppointments =
    features?.appointments !== false && viewer.permissions.includes("appointments.view");
  const canOpenAssignments = features?.leads !== false;
  const nothingWaiting =
    !whoNext &&
    callbacks.overdue + callbacks.dueToday + callbacks.unscheduled === 0 &&
    workItems.open === 0 &&
    signals.length === 0 &&
    appointmentsToday.count === 0;

  return (
    <PageContainer>
      <PageHeader
        title="My Day"
        description="What to do right now — and how today is going. Everything on this page is yours alone."
      >
        {/* The page's ONE primary action: the recommended call, or the dialer. */}
        {whoNext ? (
          <Link
            // The callback id rides along so filing the disposition CLOSES the
            // promise — the same contract the callbacks board uses.
            href={dialDeepLink({
              phone: whoNext.phone,
              name: whoNext.name,
              callbackId: whoNext.callbackId,
            })}
            className={buttonVariants({ size: "sm" })}
          >
            <PhoneCall className="mr-1.5 h-4 w-4" />
            Call {whoNext.name.split(" ")[0] || "now"}
          </Link>
        ) : (
          <Link href="/dialer" className={buttonVariants({ size: "sm" })}>
            <Phone className="mr-1.5 h-4 w-4" />
            Open the dialer
          </Link>
        )}
      </PageHeader>

      {/* Who next — the recommendation, with its reason stated. */}
      {whoNext && (
        <SectionCard
          title="Who should I call next?"
          description="Picked from your promises and signals — never anyone on the Do-Not-Call list, outside calling hours, or held by another rep."
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold">{whoNext.name}</p>
              <p className="text-sm text-muted-foreground tabular">
                {formatPhone(whoNext.phone)}
              </p>
              <p className="mt-1 text-sm text-foreground">{whoNext.reason}</p>
            </div>
            <Badge
              tone={
                whoNext.source === "signal"
                  ? "danger"
                  : whoNext.source === "callback"
                    ? "warning"
                    : "neutral"
              }
              className="capitalize"
            >
              {whoNext.source === "work_item" ? "task" : whoNext.source}
            </Badge>
          </div>
        </SectionCard>
      )}

      {nothingWaiting && (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing is waiting on you"
          description={`No callbacks due, no open tasks, no hot signals. Load ${vocab.leadNounPlural} into the dialer to keep the day moving.`}
        />
      )}

      {/* Start here — the queues with your name on them. Empty ones collapse. */}
      {(callbacks.overdue > 0 ||
        callbacks.dueToday > 0 ||
        callbacks.unscheduled > 0 ||
        workItems.open > 0 ||
        signals.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {(callbacks.overdue > 0 || callbacks.dueToday > 0 || callbacks.unscheduled > 0) && (
            <SectionCard
              title="Your callbacks"
              description="Promises with your name on them · today"
            >
              <div className="mb-3 flex flex-wrap gap-2">
                {callbacks.overdue > 0 && (
                  <Badge tone="danger" className="gap-1">
                    <AlarmClock className="h-3 w-3" /> {callbacks.overdue} overdue
                  </Badge>
                )}
                {callbacks.dueToday > 0 && (
                  <Badge tone="warning" className="gap-1">
                    <PhoneIncoming className="h-3 w-3" /> {callbacks.dueToday} due later today
                  </Badge>
                )}
                {callbacks.unscheduled > 0 && (
                  <Badge tone="neutral">{callbacks.unscheduled} without a time</Badge>
                )}
              </div>
              <ul className="space-y-2">
                {callbacks.items.map((cb) => (
                  <li key={cb.id} className="flex items-center gap-2.5 text-sm">
                    <PhoneIncoming className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {cb.name || formatPhone(cb.phone)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">
                      {/* Floating wall clock vs floating now — see
                          floatingRelativeTime. */}
                      {cb.dueAt
                        ? floatingRelativeTime(cb.dueAt, nowFloating)
                        : "no time set"}
                    </span>
                  </li>
                ))}
              </ul>
              {canOpenCallbacks && (
                <Link
                  href="/callbacks"
                  className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
                >
                  Work the callback queue →
                </Link>
              )}
            </SectionCard>
          )}

          {(workItems.open > 0 || signals.length > 0) && (
            <SectionCard
              title="Tasks & signals"
              description="Open work and live alerts on your book"
            >
              {signals.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {signals.map((sig) => (
                    <li key={sig.id} className="flex items-start gap-2.5 text-sm">
                      <Flame
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${sig.severity >= 4 ? "text-danger" : "text-warning"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {sig.leadName || sig.type.replace(/_/g, " ")}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          — {sig.reason || sig.type.replace(/_/g, " ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular">
                        {relativeTime(sig.detectedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {workItems.items.length > 0 && (
                <ul className="space-y-2">
                  {workItems.items.map((w) => (
                    <li key={w.id} className="flex items-start gap-2.5 text-sm">
                      <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 text-muted-foreground">
                        {w.reason || w.type.replace(/_/g, " ")}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular">
                        {w.dueAt ? relativeTime(w.dueAt) : "anytime"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {workItems.open > workItems.items.length && (
                <p className="mt-2 text-xs text-muted-foreground">
                  +{workItems.open - workItems.items.length} more open task
                  {workItems.open - workItems.items.length === 1 ? "" : "s"}
                </p>
              )}
            </SectionCard>
          )}
        </div>
      )}

      {/* Appointments today. */}
      {appointmentsToday.count > 0 && (
        <SectionCard
          title={`${vocab.AppointmentNounPlural} today`}
          description={`${appointmentsToday.count} on your calendar · today`}
        >
          <ul className="space-y-2">
            {appointmentsToday.items.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 text-sm">
                <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{a.name || "—"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {a.scheduledLabel ||
                    (a.scheduledAt
                      ? floatingRelativeTime(a.scheduledAt, nowFloating)
                      : "no time")}
                </span>
              </li>
            ))}
          </ul>
          {canOpenAppointments && (
            <Link
              href="/appointments"
              className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
            >
              Open the calendar →
            </Link>
          )}
        </SectionCard>
      )}

      {/* Assignment progress. */}
      {assignments.length > 0 && (
        <SectionCard title="Your assignments" description="Progress on the lists dealt to you">
          <ul className="space-y-3">
            {assignments.map((a) => {
              const pct = a.total > 0 ? Math.round((a.worked / a.total) * 100) : 0;
              return (
                <li key={a.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{a.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">
                      {a.worked} / {a.total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {canOpenAssignments && (
            <Link
              href="/assignments"
              className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
            >
              All assignments →
            </Link>
          )}
        </SectionCard>
      )}

      {/* End-of-day readout — always rendered: real zeros are information here,
          and the scope + window are on the card ("You · today"). */}
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Today so far · you · org time
        </p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Dials" value={String(today.dials)} icon={Phone} accent="accent" />
          <MetricCard
            label="Conversations"
            value={String(today.conversations)}
            icon={PhoneCall}
            accent="success"
          />
          <MetricCard
            label={`${vocab.AppointmentNounPlural} booked`}
            value={String(today.appointments)}
            icon={CalendarCheck}
            accent="warning"
          />
          <MetricCard
            label="Talk time"
            value={today.talkSec > 0 ? formatDuration(today.talkSec) : "0:00"}
            icon={Timer}
            accent="accent"
          />
        </div>
      </div>
    </PageContainer>
  );
}
