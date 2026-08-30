"use client";

import {
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  Loader2,
  MailWarning,
  Pencil,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ApptBucket } from "@/lib/appointments-organize";
import { whenLabel } from "@/lib/appointments/time";
import type { AppointmentRow } from "@/lib/db/pipeline";
import { cn, formatPhone, initials } from "@/lib/utils";
import {
  BUCKET_META,
  type ApptAccess,
  type Density,
  isReview,
  STATUS_META,
} from "./shared";

// The bucketed triage list: AI proposals awaiting approval, then what's overdue,
// today, tomorrow. It is the view you work FROM; the calendar is the view you
// plan IN. Both matter, which is why the rebuild kept this rather than replacing
// it with a grid and calling it done.

export interface ListApi {
  busyId: string | null;
  selected: Set<string>;
  access: ApptAccess;
  density: Density;
  onToggle: (id: string) => void;
  onApprove: (id: string) => void;
  onOpen: (a: AppointmentRow) => void;
}

export function BucketSection({
  bucket,
  items,
  api,
  collapsed,
  onToggleCollapsed,
}: {
  bucket: ApptBucket;
  items: AppointmentRow[];
  api: ListApi;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const meta = BUCKET_META[bucket];
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggleCollapsed}
        disabled={!onToggleCollapsed}
        className={cn(
          "flex w-full items-center gap-2.5 border-b border-border/60 px-5 py-3.5 text-left",
          onToggleCollapsed && "transition-colors hover:bg-muted/40",
        )}
      >
        <Badge tone={meta.tone} className="shrink-0">
          {meta.label}
        </Badge>
        <span className="hidden text-xs text-muted-foreground sm:inline">{meta.hint}</span>
        <span className="ml-auto flex items-center gap-2 text-xs font-semibold tabular text-muted-foreground">
          {items.length}
          {onToggleCollapsed && (
            <ChevronRight className={cn("h-4 w-4 transition-transform", !collapsed && "rotate-90")} />
          )}
        </span>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border/60">
          {items.map((a) => (
            <ApptRow key={a.id} a={a} api={api} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ApptRow({ a, api }: { a: AppointmentRow; api: ListApi }) {
  const compact = api.density === "compact";
  const status = STATUS_META[a.status] ?? STATUS_META.scheduled;
  const review = isReview(a);
  const busy = api.busyId === a.id;
  const checked = api.selected.has(a.id);
  const selectable = review && api.access.canManage;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => api.onOpen(a)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          api.onOpen(a);
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
        // Vertical only. Horizontal padding held at px-5 and the type held at
        // its own size: Compact used to re-typeset the appointment's name and
        // move the whole row sideways.
        "px-5",
        compact ? "py-2.5" : "py-3.5",
      )}
    >
      {selectable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            api.onToggle(a.id);
          }}
          aria-label={checked ? "Deselect" : "Select"}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            checked
              ? "border-primary bg-primary text-white"
              : "border-border bg-surface hover:border-primary/60",
          )}
        >
          {checked && <Check className="h-3.5 w-3.5" />}
        </button>
      )}

      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl font-semibold",
          // The avatar box may shrink — it is a box, not text. Its monogram
          // does not: text-[11px] is below the legibility floor anyway.
          "text-xs",
          compact ? "h-8 w-8" : "h-10 w-10",
          review ? "bg-warning/15 text-warning" : "bg-accent-soft text-accent",
        )}
      >
        {/* Held constant. `h-3.5` is 14px and `h-4` is 12px on this project's
            spacing scale, so the compact branch made the icon BIGGER — the one
            thing density is not allowed to touch, in the wrong direction. */}
        {a.source === "ai" ? (
          <Sparkles className="h-4 w-4" />
        ) : (
          initials(a.leadName)
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold">{a.leadName}</p>
          {a.source === "ai" && (
            <Badge tone="accent" className="hidden gap-1 sm:inline-flex">
              <Sparkles className="h-3 w-3" />
              {a.agent === "secondary" ? "Agent 2" : a.agent === "primary" ? "Agent 1" : "AI"}
            </Badge>
          )}
          {a.notifyStatus === "failed" && (
            <Badge tone="danger" className="gap-1" title="The notification email never sent.">
              <MailWarning className="h-3 w-3" /> Email failed
            </Badge>
          )}
        </div>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" />
          {whenLabel(a)}
          {api.access.canTeam && a.repName && <span className="truncate">· {a.repName}</span>}
          {a.phone && <span className="hidden truncate md:inline">· {formatPhone(a.phone)}</span>}
        </p>
      </div>

      {review && api.access.canManage ? (
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {/* "Approve" is `hidden sm:inline`, so on a phone these are two
              unlabelled icons — on the control that books somebody's time. */}
          <Button
            size="sm"
            variant="success"
            onClick={() => api.onApprove(a.id)}
            disabled={busy}
            aria-label={`Approve the appointment for ${a.leadName}`}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Approve</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => api.onOpen(a)}
            aria-label={`Open the appointment for ${a.leadName}`}
            className="gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        </div>
      ) : (
        <Badge tone={status.tone} className="shrink-0">
          {status.label}
        </Badge>
      )}
    </div>
  );
}

export function ReviewCallout({
  count,
  allSelected,
  onSelectAll,
}: {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {count} AI {count === 1 ? "proposal" : "proposals"} awaiting review
        </p>
        <p className="text-xs text-muted-foreground">
          Approve to confirm the booking, edit the time, or route the lead back to another
          disposition. Nothing is emailed until you approve.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onSelectAll} className="gap-1.5">
        <CheckCheck className="h-3.5 w-3.5" />
        {allSelected ? "Clear selection" : "Select all"}
      </Button>
    </div>
  );
}
