"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Busy, conflictsAt, type ConflictCandidate } from "@/lib/appointments/conflicts";
import {
  DEFAULT_DURATION_MIN,
  parseFloating,
  SLOT_MIN,
  snapMinutes,
  startOfDay,
  toFloatingString,
} from "@/lib/appointments/time";

// ─────────────────────────────────────────────────────────────────────────────
// Drag-to-reschedule and drag-to-resize, on raw pointer events.
//
// Not HTML5 drag-and-drop: it has no touch support at all (reps use tablets),
// its `dragover` granularity is too coarse for 15-minute snapping, and the drag
// image can't be styled into something that looks like the app. Not framer's
// `drag` either: it moves the element rather than telling us WHERE the pointer
// is, and the whole job here is hit-testing a grid cell under the cursor.
//
// Pointer events give all three for free — mouse, touch and pen through one API,
// continuous coordinates, and pointer capture so a fast drag that outruns the
// cursor doesn't drop the gesture.
//
// The grid owns the geometry: it registers a `hitTest` that turns a screen point
// into a wall-clock slot. Month says "this day, keep the time"; week/day says
// "this day at 2:15pm". The hook never needs to know which grid it's driving.
// ─────────────────────────────────────────────────────────────────────────────

export type DragMode = "move" | "resize";

/** Screen point → the slot under it. Null when the pointer is off the grid. */
export type HitTest = (
  clientX: number,
  clientY: number,
) => { start: Date; hasTime: boolean } | null;

export interface DraggableAppt {
  id: string;
  scheduledAt: string | null;
  durationMin: number;
  assignedTo: string | null;
  ownerId: string;
  status: string;
}

export interface DragPreview {
  id: string;
  mode: DragMode;
  start: Date;
  durationMin: number;
  conflicts: Busy[];
  /** False until the pointer clears the click threshold — a click is not a drag. */
  active: boolean;
}

interface Origin {
  x: number;
  y: number;
  appt: DraggableAppt;
  mode: DragMode;
  start: Date;
  durationMin: number;
  pxPerHour: number;
}

// Below this, the gesture is a click that opens the dialog, not a drag. Without
// it, every click nudges the appointment by a pixel and writes to the database.
const THRESHOLD_PX = 4;

export function useAppointmentDrag({
  appts,
  enabled,
  onCommit,
}: {
  appts: ConflictCandidate[];
  enabled: boolean;
  onCommit: (id: string, scheduledAt: string, durationMin: number) => void;
}) {
  const [preview, setPreview] = useState<DragPreview | null>(null);

  const hitRef = useRef<HitTest | null>(null);
  const originRef = useRef<Origin | null>(null);
  const previewRef = useRef<DragPreview | null>(null);
  const apptsRef = useRef(appts);
  const onCommitRef = useRef(onCommit);
  // Set on a real drag so the click that follows pointerup doesn't also open the
  // dialog on top of the reschedule the user just made.
  const suppressClick = useRef(false);

  previewRef.current = preview;
  apptsRef.current = appts;
  onCommitRef.current = onCommit;

  /** The grid calls this to hand the hook its geometry. */
  const registerHitTest = useCallback((fn: HitTest | null) => {
    hitRef.current = fn;
  }, []);

  const begin = useCallback(
    (e: React.PointerEvent, appt: DraggableAppt, mode: DragMode, pxPerHour = 0) => {
      // Only a primary press, only when the viewer may actually write, and only
      // for something that has a time to move.
      if (!enabled || e.button !== 0) return;
      if (appt.status === "cancelled") return;
      const start = parseFloating(appt.scheduledAt);
      if (!start) return;

      const durationMin = appt.durationMin || DEFAULT_DURATION_MIN;
      originRef.current = { x: e.clientX, y: e.clientY, appt, mode, start, durationMin, pxPerHour };
      setPreview({ id: appt.id, mode, start, durationMin, conflicts: [], active: false });
    },
    [enabled],
  );

  useEffect(() => {
    if (!preview) return;

    const conflictsFor = (id: string, assignee: string | null, start: Date, durationMin: number) =>
      conflictsAt({ id, assignee }, start, durationMin, apptsRef.current);

    function onMove(e: PointerEvent) {
      const o = originRef.current;
      if (!o) return;

      const dx = e.clientX - o.x;
      const dy = e.clientY - o.y;
      if (!previewRef.current?.active && Math.hypot(dx, dy) < THRESHOLD_PX) return;

      const assignee = o.appt.assignedTo || o.appt.ownerId || null;

      if (o.mode === "resize") {
        // Only the bottom edge moves; the start is pinned.
        if (o.pxPerHour <= 0) return;
        const deltaMin = snapMinutes((dy / o.pxPerHour) * 60, SLOT_MIN);
        const durationMin = Math.max(SLOT_MIN, Math.min(600, o.durationMin + deltaMin));
        setPreview({
          id: o.appt.id,
          mode: "resize",
          start: o.start,
          durationMin,
          conflicts: conflictsFor(o.appt.id, assignee, o.start, durationMin),
          active: true,
        });
        return;
      }

      const hit = hitRef.current?.(e.clientX, e.clientY);
      // Off the grid (over the toolbar, past the edge) — hold the last good
      // preview rather than snapping the card back to its origin mid-gesture.
      if (!hit) return;

      // A month cell has no time in it. Moving an appointment from Tuesday to
      // Thursday must not silently reset it to midnight — carry its own clock.
      const start = hit.hasTime
        ? hit.start
        : (() => {
            const d = startOfDay(hit.start);
            d.setHours(o.start.getHours(), o.start.getMinutes(), 0, 0);
            return d;
          })();

      setPreview({
        id: o.appt.id,
        mode: "move",
        start,
        durationMin: o.durationMin,
        conflicts: conflictsFor(o.appt.id, assignee, start, o.durationMin),
        active: true,
      });
    }

    function onUp() {
      const p = previewRef.current;
      const o = originRef.current;
      originRef.current = null;
      setPreview(null);

      if (!p?.active || !o) return;

      suppressClick.current = true;
      // Cleared on the next tick — long enough for the click event that follows
      // this pointerup, short enough that the next real click still works.
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);

      const movedTime = p.start.getTime() !== o.start.getTime();
      const movedDuration = p.durationMin !== o.durationMin;
      if (!movedTime && !movedDuration) return;

      onCommitRef.current(p.id, toFloatingString(p.start), p.durationMin);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      originRef.current = null;
      setPreview(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [preview]);

  /** True right after a drag — the grid checks this before treating a click as "open". */
  const didDrag = useCallback(() => suppressClick.current, []);

  return { preview, begin, registerHitTest, didDrag, dragging: Boolean(preview?.active) };
}
