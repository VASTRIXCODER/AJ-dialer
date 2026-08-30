"use client";

import { Plus, Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { conflictedIds } from "@/lib/appointments/conflicts";
import {
  dayKey,
  formatTime,
  isToday,
  monthGrid,
  parseFloating,
  startOfDay,
} from "@/lib/appointments/time";
import type { AppointmentRow } from "@/lib/db/pipeline";
import { cn } from "@/lib/utils";
import { chipGlyph, chipTone, isDead, isReview, type ApptAccess } from "./shared";
import type { DragPreview, DraggableAppt, HitTest } from "./use-appointment-drag";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Beyond this a cell becomes an unreadable stack; the rest collapse to "+N more". */
const MAX_CHIPS = 3;

export function CalendarMonth({
  anchor,
  appts,
  access,
  preview,
  onBeginDrag,
  registerHitTest,
  didDrag,
  onOpen,
  onCreate,
}: {
  anchor: Date;
  appts: AppointmentRow[];
  access: ApptAccess;
  preview: DragPreview | null;
  onBeginDrag: (e: React.PointerEvent, a: DraggableAppt, mode: "move" | "resize") => void;
  registerHitTest: (fn: HitTest | null) => void;
  didDrag: () => boolean;
  onOpen: (a: AppointmentRow) => void;
  onCreate: (start: Date) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => monthGrid(anchor), [anchor]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Hit-test by asking each day cell where it is. A month cell has no time axis,
  // so `hasTime: false` tells the drag hook to keep the appointment's own clock
  // and change only its date.
  const hitTest = useCallback<HitTest>((clientX, clientY) => {
    const root = gridRef.current;
    if (!root) return null;
    const cellEls = root.querySelectorAll<HTMLElement>("[data-day]");
    for (const el of cellEls) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        const key = el.dataset.day;
        if (!key) return null;
        const [y, m, d] = key.split("-").map(Number);
        return { start: new Date(y, m - 1, d), hasTime: false };
      }
    }
    return null;
  }, []);

  useEffect(() => {
    registerHitTest(hitTest);
    return () => registerHitTest(null);
  }, [hitTest, registerHitTest]);

  // Appointments with no pinned time have no place on a grid — they're surfaced
  // in the list view's "Later" bucket and in the workspace's unscheduled rail.
  const byDay = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const a of appts) {
      const start = parseFloating(a.scheduledAt);
      if (!start) continue;
      const key = dayKey(start);
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    for (const list of map.values()) {
      list.sort(
        (x, y) =>
          (parseFloating(x.scheduledAt)?.getTime() ?? 0) -
          (parseFloating(y.scheduledAt)?.getTime() ?? 0),
      );
    }
    return map;
  }, [appts]);

  const clashing = useMemo(() => conflictedIds(appts), [appts]);
  const anchorMonth = anchor.getMonth();

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border/60 bg-surface-muted/50">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </div>
        ))}
      </div>

      <div ref={gridRef} className="grid grid-cols-7">
        {cells.map((day) => {
          const key = dayKey(day);
          const items = byDay.get(key) ?? [];
          const outside = day.getMonth() !== anchorMonth;
          const today = isToday(day);
          const isOpen = expanded === key;
          const shown = isOpen ? items : items.slice(0, MAX_CHIPS);
          const hidden = items.length - shown.length;
          // The cell the pointer is currently over during a drag.
          const isDropTarget =
            preview?.active && preview.mode === "move" && dayKey(preview.start) === key;

          return (
            <div
              key={key}
              data-day={key}
              className={cn(
                "group/cell relative min-h-[116px] border-b border-r border-border/50 p-1.5 transition-colors last:border-r-0 [&:nth-child(7n)]:border-r-0",
                outside && "bg-surface-muted/30",
                isDropTarget &&
                  (preview.conflicts.length
                    ? "bg-danger/10 ring-1 ring-inset ring-danger/40"
                    : "bg-primary/10 ring-1 ring-inset ring-primary/40"),
              )}
            >
              <div className="mb-1 flex items-center justify-between px-0.5">
                <span
                  className={cn(
                    "flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular",
                    today
                      ? "bg-primary text-primary-foreground"
                      : outside
                        ? "text-ink-3"
                        : "text-muted-foreground",
                  )}
                >
                  {day.getDate()}
                </span>
                {access.canManage && (
                  <button
                    type="button"
                    onClick={() => onCreate(withHour(day, 10))}
                    aria-label={`Add an appointment on ${key}`}
                    // `opacity-0` unhidden only by group-hover is invisible on
                    // a touch device — and still hit-testable, so a tap near
                    // the date number silently opened the new-appointment
                    // dialog. Visible at rest on a coarse pointer; the
                    // hover-reveal stays for a mouse, where it earns its keep.
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/cell:opacity-100 [@media(pointer:coarse)]:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {shown.map((a) => (
                  <MonthChip
                    key={a.id}
                    a={a}
                    access={access}
                    conflicted={clashing.has(a.id)}
                    ghosted={preview?.active && preview.id === a.id}
                    onBeginDrag={onBeginDrag}
                    didDrag={didDrag}
                    onOpen={onOpen}
                  />
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(key)}
                    className="w-full rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    +{hidden} more
                  </button>
                )}
                {isOpen && items.length > MAX_CHIPS && (
                  <button
                    type="button"
                    onClick={() => setExpanded(null)}
                    className="w-full rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function withHour(day: Date, hour: number): Date {
  const d = startOfDay(day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function MonthChip({
  a,
  access,
  conflicted,
  ghosted,
  onBeginDrag,
  didDrag,
  onOpen,
}: {
  a: AppointmentRow;
  access: ApptAccess;
  conflicted: boolean;
  ghosted?: boolean;
  onBeginDrag: (e: React.PointerEvent, a: DraggableAppt, mode: "move" | "resize") => void;
  didDrag: () => boolean;
  onOpen: (a: AppointmentRow) => void;
}) {
  const start = parseFloating(a.scheduledAt);
  const draggable = access.canManage && a.status !== "cancelled";
  const glyph = chipGlyph(a);

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={(e) => draggable && onBeginDrag(e, a, "move")}
      onClick={() => {
        // The pointerup that ended a drag is followed by a click. Without this,
        // every reschedule would also pop the dialog open on top of it.
        if (didDrag()) return;
        onOpen(a);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(a);
        }
      }}
      title={`${a.leadName} — ${start ? formatTime(start) : "No time"}${glyph ? ` · ${glyph.label}` : ""}`}
      className={cn(
        "flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-left text-[11px] font-medium transition-shadow",
        chipTone(a),
        draggable ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",
        ghosted && "opacity-40",
        "hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
    >
      {/* The state, as a character. chipTone is colour only, so completed vs
          scheduled and cancelled vs no-show were hue-only distinctions. */}
      {glyph && (
        <span aria-hidden className="shrink-0 font-bold leading-none">
          {glyph.glyph}
        </span>
      )}
      {a.source === "ai" && <Sparkles className="h-2.5 w-2.5 shrink-0" />}
      {conflicted && <TriangleAlert className="h-2.5 w-2.5 shrink-0 text-danger" />}
      {start && <span className="shrink-0 tabular opacity-80">{shortTime(start)}</span>}
      <span className={cn("truncate", isDead(a) && "line-through")}>{a.leadName}</span>
      {isReview(a) && <span className="ml-auto shrink-0 text-[11px] font-bold uppercase">●</span>}
    </div>
  );
}

/** "2p" / "2:30p" — a month cell has no room for "2:30 PM". */
function shortTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? "a" : "p";
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}
