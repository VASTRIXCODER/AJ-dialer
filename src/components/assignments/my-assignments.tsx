"use client";

import { ArrowRight, Bot, CalendarClock, ClipboardList, Hand, PhoneCall } from "lucide-react";
import Link from "next/link";
import { useVocabulary } from "@/components/layout/vocabulary";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Ring } from "@/components/ui/progress";
import {
  assignmentLane,
  remainingCount,
  workedCount,
  type AssignmentLane,
} from "@/lib/assignments/plan";
import type { AssignmentRecord } from "@/lib/db/assignments";
import { cn, relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// My Assignments — the rep's side of the Assignment Center. Lanes by urgency
// (Overdue jumps the queue visually — that's its whole job), each card one
// click from the dialer scoped to exactly that pack of work.
// ─────────────────────────────────────────────────────────────────────────────

const LANES: { key: AssignmentLane; label: string; tone: string }[] = [
  { key: "overdue", label: "Overdue", tone: "text-danger" },
  { key: "active", label: "Active", tone: "text-primary" },
  { key: "paused", label: "Paused", tone: "text-muted-foreground" },
  { key: "completed", label: "Done", tone: "text-success" },
];

function DialingModeChip({ mode }: { mode: AssignmentRecord["dialingMode"] }) {
  if (mode === "manual")
    return (
      <Badge tone="neutral" className="gap-1">
        <Hand className="h-3 w-3" /> Manual
      </Badge>
    );
  if (mode === "ai")
    return (
      <Badge tone="accent" className="gap-1">
        <Bot className="h-3 w-3" /> AI
      </Badge>
    );
  return (
    <Badge tone="outline" className="gap-1">
      <PhoneCall className="h-3 w-3" /> Any mode
    </Badge>
  );
}

function DueChip({ a }: { a: AssignmentRecord }) {
  if (!a.dueDate) return null;
  const label = a.overdue
    ? `Overdue · was due ${relativeTime(a.dueDate)}`
    : `Due ${relativeTime(a.dueDate)}`;
  return (
    <Badge tone={a.overdue ? "danger" : a.dueSoon ? "warning" : "neutral"} className="gap-1">
      <CalendarClock className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function MyAssignmentCard({
  assignment: a,
  leadNoun,
}: {
  assignment: AssignmentRecord;
  leadNoun: string;
}) {
  const pct = a.progress.total > 0 ? (workedCount(a.progress) / a.progress.total) * 100 : 0;
  const remaining = remainingCount(a.progress);
  const workable = a.status === "active" && remaining > 0;
  return (
    <Card className={cn("p-4", a.overdue && "border-danger/40")}>
      <div className="flex items-start gap-3.5">
        <Ring value={pct} size={52} stroke={5}>
          {Math.round(pct)}%
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={a.label}>
            {a.label}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular">
            {workedCount(a.progress)}/{a.progress.total} worked
            {remaining > 0 ? ` · ${remaining} ${leadNoun}${remaining === 1 ? "" : "s"} left` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <DueChip a={a} />
            <DialingModeChip mode={a.dialingMode} />
            {a.status === "paused" && <Badge tone="warning">Paused</Badge>}
            {a.status === "completed" && <Badge tone="success">Completed</Badge>}
          </div>
        </div>
      </div>
      {workable && (
        <Link
          href={`/dialer?assignment=${a.id}`}
          className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3 w-full gap-1.5" })}
        >
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </Card>
  );
}

export function MyAssignments({ assignments }: { assignments: AssignmentRecord[] }) {
  const vocab = useVocabulary();
  const byLane = new Map<AssignmentLane, AssignmentRecord[]>();
  for (const a of assignments) {
    const lane = assignmentLane(a.status, a.overdue);
    byLane.set(lane, [...(byLane.get(lane) ?? []), a]);
  }

  return (
    <>
      <PageHeader
        title="My Assignments"
        description={`The ${vocab.leadNounPlural} handed to you, ready to work through.`}
      />
      {assignments.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing assigned to you yet"
          description={`When a manager allocates ${vocab.leadNounPlural} to you, they'll show up here — each one a click away from the dialer.`}
        />
      ) : (
        <div className="space-y-6">
          {LANES.map(({ key, label, tone }) => {
            const lane = byLane.get(key) ?? [];
            if (!lane.length) return null;
            return (
              <section key={key} aria-label={`${label} assignments`}>
                <h2 className={cn("mb-2.5 text-sm font-semibold uppercase tracking-wide", tone)}>
                  {label}
                  <span className="ml-2 text-muted-foreground tabular">{lane.length}</span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {lane.map((a) => (
                    <MyAssignmentCard key={a.id} assignment={a} leadNoun={vocab.leadNoun} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
