import { AlarmClock, CheckCircle2, Clock, PhoneCall, PhoneIncoming, Users } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CallbackBoard } from "@/components/callbacks/callback-board";
import { ReviewLane } from "@/components/callbacks/review-lane";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { reconcileOwnerActiveCalls } from "@/lib/ai-call-reconcile";
import { laneOf, orgNowMs } from "@/lib/callbacks/lanes";
import { zonedFloatingNow } from "@/lib/dialer/schedule";
import { orgTimezone } from "@/lib/metrics/definitions";
import { getCallbackBoard } from "@/lib/db/callbacks";
import { getReviewQueue } from "@/lib/db/review-queue";
import { getScope } from "@/lib/db/scope";
import { getViewer, listMembers } from "@/lib/org/membership";

export const metadata = { title: "Callbacks" };
export const dynamic = "force-dynamic";

/**
 * The callback workspace. This server shell renders the KPIs; the board itself
 * is client-interactive (claim→dial, reschedule, reassign, priority, status) —
 * see src/components/callbacks/callback-board.tsx. Lanes and escalation tiers
 * are DERIVED from due_at against the clock (src/lib/callbacks/lanes.ts),
 * never stored, and both this shell and the board compute them from the SAME
 * `now` so the numbers can't disagree at hydration.
 *
 * Dialing policy lives elsewhere on purpose: a due callback bypasses cooldown /
 * max-attempts via the eligibility engine's `dueCallbackLeadIds` input
 * (src/lib/dialer/eligibility.ts) — and NEVER bypasses DNC or the calling
 * window; the dial route scrubs every number regardless.
 */
export default async function CallbacksPage() {
  const [viewer, scope] = await Promise.all([getViewer(), getScope()]);
  // Finalize any stuck calls first so callback-dispositioned ones show up.
  await reconcileOwnerActiveCalls();
  const [board, reviews] = await Promise.all([
    getCallbackBoard(scope),
    // The needs-review lane (F1): calls the AI analyzer declined to
    // disposition on its own, plus rep-flagged wrap-ups.
    getReviewQueue(scope),
  ]);

  // The manager surface: reassign + priority ride on `assignments.manage` —
  // callbacks are distributed work, same permission that deals lead packs.
  const canManage = viewer.permissions.includes("assignments.manage");
  const members =
    canManage && viewer.org
      ? (await listMembers(viewer.org.id))
          .filter((m) => m.status === "active")
          .map((m) => ({ id: m.userId, name: m.name }))
      : [];

  // The all-clear screen. `reviews.unavailable` is part of the test because an
  // empty review lane and an unreadable one look identical from here, and only
  // one of them means there is nothing to do.
  if (
    board.open.length === 0 &&
    board.closed.length === 0 &&
    board.completedCount === 0 &&
    reviews.rows.length === 0 &&
    !reviews.unavailable
  ) {
    return (
      <PageContainer>
        <PageHeader
          title="Callbacks"
          description="Every promised callback, tracked so nothing slips through the cracks."
        />
        <EmptyState
          variant="page"
          icon={PhoneIncoming}
          title="No callbacks scheduled"
          description="Promised callbacks from your reps and the AI agent are tracked here automatically."
        />
      </PageContainer>
    );
  }

  // One clock for the KPIs AND the board's first client render — and it is the
  // ORG's wall clock, not the server's. `due_at` is a floating time, so
  // comparing it against a bare Date.now() on a UTC server read a Chicago org's
  // 5pm promise as overdue from noon. See orgNowMs.
  const orgTz = orgTimezone(viewer.org);
  const now = orgNowMs(new Date(), zonedFloatingNow(new Date(), orgTz));
  const count = (k: string) => board.open.filter((c) => laneOf(c.dueAt, now) === k).length;
  // Past the open-list cap these three are floors, not totals — and the rows
  // dropped first are the unscheduled ones, which /today counts separately and
  // exactly. Say so on the tiles rather than letting the two screens disagree
  // in silence.
  const laneDetail = board.openTruncated ? "first 500 open only" : undefined;

  return (
    <PageContainer>
      <PageHeader
        title="Callbacks"
        description="Every promised callback, tracked and claimable — so nothing slips and nobody double-dials."
      >
        {board.teamWide && (
          <Badge tone="primary" className="gap-1">
            <Users className="h-3 w-3" /> Team-wide
          </Badge>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Overdue"
          value={String(count("overdue"))}
          windowDetail={laneDetail}
          definitionKey="callbacks_overdue"
          window="current"
          scope={board.teamWide ? "org" : "me"}
          icon={AlarmClock}
          accent="danger"
        />
        <MetricCard
          label="Due now"
          value={String(count("due"))}
          windowDetail={laneDetail}
          definitionKey="callbacks_due_now"
          window="current"
          scope={board.teamWide ? "org" : "me"}
          icon={Clock}
          accent="warning"
        />
        <MetricCard
          label="Upcoming"
          value={String(count("upcoming"))}
          windowDetail={laneDetail}
          // Deliberately NOT keyed. /appointments has a tile with this exact
          // label counting a bounded today→+7d→later window of appointments;
          // this one counts callbacks with any future due time and no horizon
          // at all. Naming them the same in a glossary would assert a
          // reconciliation that has not happened.
          sub="promised for later · open callbacks"
          icon={CheckCircle2}
          accent="accent"
        />
        <MetricCard
          label="Completed"
          // `completedCount` is `number | null` precisely so a failed count can
          // say so. `String(null)` is the string "null", which MetricCard
          // cannot parse as a number and therefore rendered VERBATIM — the word
          // "null", in 40px tabular numerals, where a total should be.
          value={board.completedCount === null ? null : String(board.completedCount)}
          unavailable="Couldn't count completed callbacks"
          window="all_time"
          scope={board.teamWide ? "org" : "me"}
          icon={PhoneCall}
          accent="success"
        />
      </div>

      {/* Needs review comes FIRST: unresolved calls outrank scheduled ones —
          a promise with a due time can wait its lane; an unadjudicated
          disposition is blocking the record right now. */}
      {reviews.unavailable && (
        <SectionCard title="Needs review">
          <p className="text-sm text-muted-foreground">
            We couldn&rsquo;t read the review queue, so we can&rsquo;t tell you whether any
            calls are waiting on a decision. That is not the same as none.
          </p>
        </SectionCard>
      )}

      {reviews.rows.length > 0 && (
        <ReviewLane
          rows={reviews.rows}
          dispositions={viewer.org?.settings.dispositions ?? null}
          userId={scope?.userId ?? ""}
          supervisor={scope?.supervisor ?? false}
          initialNow={now}
        />
      )}

      <CallbackBoard
        open={board.open}
        closed={board.closed}
        members={members}
        canManage={canManage}
        userId={scope?.userId ?? ""}
        initialNow={now}
        orgTimezone={orgTz}
      />
    </PageContainer>
  );
}
