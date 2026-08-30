"use client";

import { Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { conflictedIds } from "@/lib/appointments/conflicts";
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  dayKey,
  formatRange,
  gridHours,
  isToday,
  minutesFromMidnight,
  offsetFromSlot,
  parseFloating,
  slotFromOffset,
} from "@/lib/appointments/time";
import type { AppointmentRow } from "@/lib/db/pipeline";
import { cn } from "@/lib/utils";
import { chipTone, isDead, isReview, type ApptAccess } from "./shared";
import type { DragPreview, DraggableAppt, HitTest } from "./use-appointment-drag";

// One component drives both Week and Day: a day view is a week with a single
// column. Same geometry, same drag maths, same hit-testing — nothing to keep in
// sync between two near-identical grids.

const PX_PER_HOUR = 56;
const GUTTER = 56; // width of the hour axis down the left edge

export function CalendarWeek({
  days,
  appts,
  access,
  preview,
  onBeginDrag,
  registerHitTest,
  didDrag,
  onOpen,
  onCreate,
}: {
  days: Date[];
  appts: AppointmentRow[];
  access: ApptAccess;
  preview: DragPreview | null;
  onBeginDrag: (
    e: React.PointerEvent,
    a: DraggableAppt,
    mode: "move" | "resize",
    pxPerHour?: number,
  ) => void;
  registerHitTest: (fn: HitTest | null) => void;
  didDrag: () => boolean;
  onOpen: (a: AppointmentRow) => void;
  onCreate: (start: Date) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const hours = useMemo(() => gridHours(), []);
  const height = (DAY_END_HOUR - DAY_START_HOUR) * PX_PER_HOUR;

  const hitTest = useCallback<HitTest>((clientX, clientY) => {
    const root = bodyRef.current;
    if (!root) return null;
    const cols = root.querySelectorAll<HTMLElement>("[data-col]");
    for (const el of cols) {
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right) continue;
      const key = el.dataset.col;
      if (!key) return null;
      const [y, m, d] = key.split("-").map(Number);
      // Clamped inside slotFromOffset, so dragging above 6am or below 9pm parks
      // the appointment at the edge instead of flinging it into another day.
      return {
        start: slotFromOffset(new Date(y, m - 1, d), clientY - r.top, PX_PER_HOUR),
        hasTime: true,
      };
    }
    return null;
  }, []);

  useEffect(() => {
    registerHitTest(hitTest);
    return () => registerHitTest(null);
  }, [hitTest, registerHitTest]);

  const byDay = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const a of appts) {
      const start = parseFloating(a.scheduledAt);
      if (!start) continue;
      // Outside the rendered window (a 5am review) there is no row to draw it in.
      const mins = minutesFromMidnight(start);
      if (mins < DAY_START_HOUR * 60 || mins >= DAY_END_HOUR * 60) continue;
      const key = dayKey(start);
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    return map;
  }, [appts]);

  const clashing = useMemo(() => conflictedIds(appts), [appts]);
  const nowOffset = useNowOffset(days);

  return (
    <Card className="overflow-hidden">
      {/* Day headers — sticky so they survive the body's own scroll. */}
      <div
        className="grid border-b border-border/60 bg-surface-muted/50"
        style={{ gridTemplateColumns: `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div />
        {days.map((d) => {
          const today = isToday(d);
          return (
            <div key={dayKey(d)} className="border-l border-border/50 px-2 py-2 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </p>
              <p
                className={cn(
                  "mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular",
                  today ? "bg-primary text-primary-foreground" : "text-foreground",
                )}
              >
                {d.getDate()}
              </p>
            </div>
          );
        })}
      </div>

      <div className="max-h-[68vh] overflow-y-auto">
        <div
          ref={bodyRef}
          className="relative grid"
          style={{ gridTemplateColumns: `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {/* Hour axis */}
          <div className="relative" style={{ height }}>
            {hours.slice(0, -1).map((h, i) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] font-medium tabular text-muted-foreground"
                style={{ top: i * PX_PER_HOUR }}
              >
                {h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const key = dayKey(day);
            const items = byDay.get(key) ?? [];
            const lanes = layout(items);
            const dropping =
              preview?.active && preview.mode !== "resize" && dayKey(preview.start) === key;

            return (
              <div
                key={key}
                data-col={key}
                className="relative border-l border-border/50"
                style={{ height }}
                onDoubleClick={(e) => {
                  if (!access.canManage) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  onCreate(slotFromOffset(day, e.clientY - r.top, PX_PER_HOUR));
                }}
              >
                {/* Hour lines */}
                {hours.slice(0, -1).map((h, i) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-border/40"
                    style={{ top: i * PX_PER_HOUR }}
                  />
                ))}

                {/* "Now" line — only on the day it belongs to. */}
                {nowOffset !== null && isToday(day) && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                    style={{ top: nowOffset }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                    <span className="h-px flex-1 bg-danger" />
                  </div>
                )}

                {/* The slot the pointer is over, previewed before it's committed. */}
                {dropping && preview && (
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-x-1 z-10 rounded-lg border-2 border-dashed",
                      preview.conflicts.length
                        ? "border-danger bg-danger/10"
                        : "border-primary bg-primary/10",
                    )}
                    style={{
                      top: offsetFromSlot(preview.start, PX_PER_HOUR),
                      height: Math.max(18, (preview.durationMin / 60) * PX_PER_HOUR),
                    }}
                  />
                )}

                {items.map((a) => {
                  const start = parseFloating(a.scheduledAt);
                  if (!start) return null;
                  const lane = lanes.get(a.id) ?? { index: 0, total: 1 };
                  const resizing = preview?.active && preview.mode === "resize" && preview.id === a.id;
                  const duration = resizing ? preview!.durationMin : a.durationMin;

                  return (
                    <WeekChip
                      key={a.id}
                      a={a}
                      start={start}
                      durationMin={duration}
                      lane={lane}
                      access={access}
                      conflicted={clashing.has(a.id)}
                      ghosted={preview?.active && preview.mode === "move" && preview.id === a.id}
                      onBeginDrag={onBeginDrag}
                      didDrag={didDrag}
                      onOpen={onOpen}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/** Where the red "now" rule sits, or null when the current time is off-grid. */
function useNowOffset(days: Date[]): number | null {
  const showsToday = days.some((d) => isToday(d));
  const now = new Date();
  if (!showsToday) return null;
  const mins = minutesFromMidnight(now);
  if (mins < DAY_START_HOUR * 60 || mins > DAY_END_HOUR * 60) return null;
  return offsetFromSlot(now, PX_PER_HOUR);
}

interface Lane {
  index: number;
  total: number;
}

/**
 * Side-by-side placement for appointments that overlap in time. Without it, two
 * 2pm reviews render exactly on top of each other and the calendar quietly lies
 * about how busy the afternoon is. Greedy column packing over a sweep — the same
 * approach every calendar uses, and enough for a rep's day.
 */
function layout(items: AppointmentRow[]): Map<string, Lane> {
  const out = new Map<string, Lane>();
  const spans = items
    .map((a) => {
      const start = parseFloating(a.scheduledAt);
      if (!start) return null;
      return {
        id: a.id,
        start: start.getTime(),
        end: start.getTime() + (a.durationMin || 60) * 60_000,
      };
    })
    .filter((v): v is { id: string; start: number; end: number } => v !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Walk in time order, breaking into clusters of mutually-overlapping items;
  // every item in a cluster shares the width, so the columns line up.
  let cluster: typeof spans = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const columns: number[] = []; // column index → end time of its last item
    const placed = new Map<string, number>();
    for (const s of cluster) {
      let col = columns.findIndex((end) => end <= s.start);
      if (col === -1) {
        col = columns.length;
        columns.push(s.end);
      } else {
        columns[col] = s.end;
      }
      placed.set(s.id, col);
    }
    for (const s of cluster) {
      out.set(s.id, { index: placed.get(s.id) ?? 0, total: columns.length });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const s of spans) {
    if (s.start >= clusterEnd && cluster.length) flush();
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  flush();

  return out;
}

function WeekChip({
  a,
  start,
  durationMin,
  lane,
  access,
  conflicted,
  ghosted,
  onBeginDrag,
  didDrag,
  onOpen,
}: {
  a: AppointmentRow;
  start: Date;
  durationMin: number;
  lane: Lane;
  access: ApptAccess;
  conflicted: boolean;
  ghosted?: boolean;
  onBeginDrag: (
    e: React.PointerEvent,
    a: DraggableAppt,
    mode: "move" | "resize",
    pxPerHour?: number,
  ) => void;
  didDrag: () => boolean;
  onOpen: (a: AppointmentRow) => void;
}) {
  const draggable = access.canManage && a.status !== "cancelled";
  const top = offsetFromSlot(start, PX_PER_HOUR);
  const height = Math.max(20, (durationMin / 60) * PX_PER_HOUR - 2);
  const widthPct = 100 / lane.total;
  // A 15-minute review is 14px tall — there is only room for one line.
  const tight = height < 40;

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={(e) => draggable && onBeginDrag(e, a, "move", PX_PER_HOUR)}
      onClick={() => {
        if (didDrag()) return;
        onOpen(a);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(a);
        }
      }}
      title={`${a.leadName} — ${formatRange(start, durationMin)}`}
      className={cn(
        "absolute z-10 overflow-hidden rounded-lg border px-1.5 py-1 text-left shadow-soft transition-shadow",
        chipTone(a),
        draggable ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",
        ghosted && "opacity-40",
        "hover:z-20 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
      style={{
        top,
        height,
        left: `calc(${lane.index * widthPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
      }}
    >
      <div className="flex items-center gap-1">
        {a.source === "ai" && <Sparkles className="h-2.5 w-2.5 shrink-0" />}
        {conflicted && <TriangleAlert className="h-2.5 w-2.5 shrink-0 text-danger" />}
        <span
          className={cn(
            "truncate text-[11px] font-semibold leading-tight",
            isDead(a) && "line-through",
          )}
        >
          {a.leadName}
        </span>
      </div>
      {!tight && (
        <p className="truncate text-[11px] leading-tight opacity-80">
          {formatRange(start, durationMin)}
        </p>
      )}
      {!tight && isReview(a) && (
        <p className="truncate text-[11px] font-bold uppercase leading-tight tracking-wide">
          Needs review
        </p>
      )}

      {/* Drag the bottom edge to change how long the review runs. */}
      {draggable && (
        <span
          onPointerDown={(e) => {
            e.stopPropagation(); // resizing is not moving
            onBeginDrag(e, a, "resize", PX_PER_HOUR);
          }}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize touch-none"
          aria-hidden
        />
      )}
    </div>
  );
}
