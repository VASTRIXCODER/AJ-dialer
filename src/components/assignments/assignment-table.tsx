"use client";

import { CalendarClock } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { workedCount, type AssignmentProgress } from "@/lib/assignments/plan";
import type { AssignmentRecord } from "@/lib/db/assignments";
import { cn, initials, relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The Assignment Center's table. Rows open the detail drawer; everything shown
// here is derived server-side (buckets, due flags) so this stays a dumb view.
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_TONE: Record<
  AssignmentRecord["status"],
  { label: string; tone: "primary" | "warning" | "success" | "neutral" }
> = {
  active: { label: "Active", tone: "primary" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export function priorityLabel(priority: number): { label: string; className: string } {
  if (priority >= 2) return { label: "Urgent", className: "text-danger" };
  if (priority === 1) return { label: "High", className: "text-warning" };
  return { label: "Normal", className: "text-muted-foreground" };
}

/** untouched / in-flight / done proportions, one bar. The three segments are
 *  the buckets folded down for the table's altitude — the drawer shows all six. */
export function SegmentedProgress({
  progress,
  className,
}: {
  progress: AssignmentProgress;
  className?: string;
}) {
  const total = Math.max(1, progress.total);
  const done = progress.completed + progress.appointment + progress.dnc;
  const inFlight = progress.inProgress + progress.callback;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div
      className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="img"
      aria-label={`${progress.untouched} untouched, ${inFlight} in progress, ${done} done of ${progress.total}`}
    >
      <div className="h-full bg-success transition-all" style={{ width: pct(done) }} />
      <div className="h-full bg-primary transition-all" style={{ width: pct(inFlight) }} />
    </div>
  );
}

export function ProgressLegend({ className }: { className?: string }) {
  const items: { label: string; dot: string }[] = [
    { label: "Done", dot: "bg-success" },
    { label: "In progress", dot: "bg-primary" },
    { label: "Untouched", dot: "bg-muted-foreground/30" },
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {items.map((i) => (
        <span
          key={i.label}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
        >
          <span className={cn("h-2 w-2 rounded-full", i.dot)} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function AssignmentTable({
  assignments,
  onSelect,
}: {
  assignments: AssignmentRecord[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2.5">Assignment</th>
            <th className="px-3 py-2.5">Assignee</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Priority</th>
            <th className="px-3 py-2.5">Due</th>
            <th className="w-[22%] px-3 py-2.5">Progress</th>
            <th className="px-3 py-2.5">Updated</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => {
            const status = STATUS_TONE[a.status];
            const prio = priorityLabel(a.priority);
            return (
              <tr
                key={a.id}
                onClick={() => onSelect(a.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(a.id);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Open assignment ${a.label}`}
                className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
              >
                <td className="max-w-[240px] px-3 py-3">
                  <p className="truncate font-semibold" title={a.label}>
                    {a.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular">
                    {a.progress.total} lead{a.progress.total === 1 ? "" : "s"}
                  </p>
                </td>
                <td className="px-3 py-3">
                  {a.assignedTo ? (
                    <span className="flex items-center gap-2">
                      <Avatar
                        initials={initials(a.assignedToName || "Teammate")}
                        seed={a.assignedTo}
                        size="xs"
                      />
                      <span className="max-w-[120px] truncate font-medium">
                        {a.assignedToName}
                      </span>
                    </span>
                  ) : (
                    <Badge tone="neutral">Unassigned</Badge>
                  )}
                </td>
                <td className="px-3 py-3">
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>
                <td className={cn("px-3 py-3 font-medium", prio.className)}>{prio.label}</td>
                <td className="px-3 py-3">
                  {a.dueDate ? (
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-medium",
                        a.overdue
                          ? "text-danger"
                          : a.dueSoon
                            ? "text-warning"
                            : "text-muted-foreground",
                      )}
                    >
                      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                      {a.overdue ? "Overdue" : relativeTime(a.dueDate)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <SegmentedProgress progress={a.progress} />
                  <p className="mt-1 text-xs text-muted-foreground tabular">
                    {workedCount(a.progress)}/{a.progress.total} worked
                  </p>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">
                  {relativeTime(a.assignedAt ?? a.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
