"use client";

import {
  Archive,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Pause,
  Pencil,
  PhoneMissed,
  Play,
  ShieldOff,
  Sparkles,
  Undo2,
  UserCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/input";
import { Timeline, type TimelineDisplayItem } from "@/components/ui/timeline";
import { useToast } from "@/components/ui/toast";
import type { AssignmentEvent, AssignmentRecord } from "@/lib/db/assignments";
import { cn, initials, relativeTime } from "@/lib/utils";
import {
  ProgressLegend,
  SegmentedProgress,
  STATUS_TONE,
  priorityLabel,
} from "./assignment-table";

// ─────────────────────────────────────────────────────────────────────────────
// Assignment detail — buckets, the audit feed, and every lifecycle action.
// Data is fetched on open (GET /api/assignments/[id]) so the drawer always
// shows live buckets, not the table's page-load snapshot.
// ─────────────────────────────────────────────────────────────────────────────

interface DetailPayload {
  assignment: AssignmentRecord;
  events: AssignmentEvent[];
}

/** action → how the feed renders it. Unknown actions still render (neutral). */
const EVENT_STYLE: Record<
  string,
  { icon: TimelineDisplayItem["icon"]; tone: TimelineDisplayItem["tone"]; label: string }
> = {
  created: { icon: Sparkles, tone: "primary", label: "Allocated" },
  assigned: { icon: UserCheck, tone: "primary", label: "Assigned" },
  reassigned: { icon: ArrowLeftRight, tone: "accent", label: "Reassigned" },
  reclaimed: { icon: Undo2, tone: "warning", label: "Reclaimed" },
  paused: { icon: Pause, tone: "warning", label: "Paused" },
  resumed: { icon: Play, tone: "success", label: "Resumed" },
  edited: { icon: Pencil, tone: "neutral", label: "Edited" },
  completed: { icon: CheckCircle2, tone: "success", label: "Completed" },
  archived: { icon: Archive, tone: "neutral", label: "Archived" },
};

export function AssignmentDetailDrawer({
  id,
  members,
  onClose,
  onChanged,
}: {
  /** null = closed. */
  id: string | null;
  members: { id: string; name: string }[];
  onClose: () => void;
  /** Called after any successful mutation so the table refreshes. */
  onChanged: () => void;
}) {
  const vocab = useVocabulary();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");

  const load = useCallback(async (packId: string) => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/assignments/${packId}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Partial<DetailPayload> & {
        error?: string;
      };
      if (!res.ok || !json.assignment) {
        setErr(json.error ?? "Couldn't load that assignment.");
        setData(null);
        return;
      }
      setData({ assignment: json.assignment, events: json.events ?? [] });
    } catch {
      setErr("Network error while loading the assignment.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) {
      setData(null);
      setReassignTo("");
      void load(id);
    }
  }, [id, load]);

  async function act(
    action: string,
    extra?: Record<string, unknown>,
    successTitle?: string,
  ) {
    if (!id) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/assignments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast({
          title: "Couldn't update the assignment",
          description: json.error,
          tone: "danger",
        });
        return;
      }
      toast({ title: successTitle ?? "Assignment updated", tone: "success" });
      onChanged();
      void load(id);
    } catch {
      toast({ title: "Network error", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  const a = data?.assignment ?? null;
  const buckets: { key: string; label: string; value: number; className?: string }[] = a
    ? [
        { key: "untouched", label: "Untouched", value: a.progress.untouched },
        { key: "inProgress", label: "In progress", value: a.progress.inProgress },
        { key: "callback", label: "Callbacks", value: a.progress.callback },
        { key: "appointment", label: "Booked", value: a.progress.appointment, className: "text-success" },
        { key: "completed", label: "Completed", value: a.progress.completed, className: "text-success" },
        { key: "dnc", label: "Do not call", value: a.progress.dnc, className: "text-danger" },
      ]
    : [];

  const timelineItems: TimelineDisplayItem[] = (data?.events ?? []).map((e) => {
    const style = EVENT_STYLE[e.action] ?? {
      icon: undefined,
      tone: "neutral" as const,
      label: e.action || "Event",
    };
    const count = typeof e.payload.count === "number" ? e.payload.count : null;
    const allocated =
      typeof e.payload.allocated === "number" ? e.payload.allocated : null;
    const n = allocated ?? count;
    return {
      id: e.id,
      at: e.createdAt,
      icon: style.icon,
      tone: style.tone,
      title: `${style.label} · ${e.actorName}`,
      detail: n != null ? `${n} ${n === 1 ? vocab.leadNoun : vocab.leadNounPlural}` : undefined,
    };
  });

  return (
    <Drawer open={id !== null} onClose={onClose} label="Assignment detail" width={560}>
      <div className="flex items-center justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-tight">
            {a?.label ?? "Assignment"}
          </h2>
          {a && (
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge tone={STATUS_TONE[a.status].tone}>{STATUS_TONE[a.status].label}</Badge>
              <span className={priorityLabel(a.priority).className}>
                {priorityLabel(a.priority).label} priority
              </span>
              {a.dueDate && (
                <span
                  className={cn(
                    "flex items-center gap-1",
                    a.overdue ? "text-danger" : a.dueSoon ? "text-warning" : undefined,
                  )}
                >
                  <CalendarClock className="h-3 w-3" />
                  {a.overdue ? "Overdue" : `Due ${relativeTime(a.dueDate)}`}
                </span>
              )}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {loading && !data ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading assignment…
          </p>
        ) : err ? (
          <p className="flex items-center gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm font-medium text-danger">
            <ShieldOff className="h-4 w-4 shrink-0" />
            {err}
          </p>
        ) : a ? (
          <>
            {/* Holder */}
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-surface/40 p-3.5">
              {a.assignedTo ? (
                <>
                  <Avatar
                    initials={initials(a.assignedToName || "Teammate")}
                    seed={a.assignedTo}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{a.assignedToName}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.assignedAt ? `Handed over ${relativeTime(a.assignedAt)}` : "Holder"}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <PhoneMissed className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Unassigned — the {vocab.leadNounPlural} sit back in the pool.
                  </p>
                </>
              )}
            </div>

            {/* Buckets */}
            <div>
              <SegmentedProgress progress={a.progress} className="h-2" />
              <ProgressLegend className="mt-2" />
              <div className="mt-3 grid grid-cols-3 gap-2">
                {buckets.map((b) => (
                  <div
                    key={b.key}
                    className="rounded-xl border border-border/70 bg-surface/30 px-3 py-2.5"
                  >
                    <p className={cn("text-lg font-bold tabular", b.className)}>{b.value}</p>
                    <p className="text-xs text-muted-foreground">{b.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Actions
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {a.status === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy !== null}
                    onClick={() => act("pause", undefined, "Assignment paused")}
                  >
                    {busy === "pause" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                    Pause
                  </Button>
                )}
                {a.status === "paused" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy !== null}
                    onClick={() => act("resume", undefined, "Assignment resumed")}
                  >
                    {busy === "resume" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Resume
                  </Button>
                )}
                {a.assignedTo && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy !== null}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "Reclaim this assignment?",
                          body: `Its remaining ${vocab.leadNounPlural} return to the unassigned pool. Work already done is untouched.`,
                          confirmLabel: "Reclaim",
                        })
                      ) {
                        void act("reclaim", undefined, "Assignment reclaimed");
                      }
                    }}
                  >
                    {busy === "reclaim" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Undo2 className="h-3.5 w-3.5" />
                    )}
                    Reclaim
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-danger hover:text-danger"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "Archive this assignment?",
                        body: "It disappears from the active table. The leads keep their current assignee and statuses.",
                        confirmLabel: "Archive",
                        tone: "danger",
                      })
                    ) {
                      void act("archive", undefined, "Assignment archived");
                    }
                  }}
                >
                  {busy === "archive" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                  Archive
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                  aria-label="Reassign to"
                  className="h-9 flex-1 py-0"
                >
                  <option value="">Reassign to…</option>
                  {members
                    .filter((m) => m.id !== a.assignedTo)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || "Teammate"}
                      </option>
                    ))}
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={!reassignTo || busy !== null}
                  onClick={() =>
                    act("reassign", { repId: reassignTo }, "Assignment reassigned")
                  }
                >
                  {busy === "reassign" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                  )}
                  Reassign
                </Button>
              </div>
            </div>

            {/* Audit feed */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Activity
              </h3>
              {timelineItems.length ? (
                <Timeline items={timelineItems} />
              ) : (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
