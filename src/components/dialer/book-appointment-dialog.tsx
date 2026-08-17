"use client";

import { CalendarCheck, Clock, MapPin, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  DEFAULT_DURATION_MIN,
  addDays,
  formatDayLabel,
  formatRange,
  parseFloating,
  startOfDay,
  toDateTimeInput,
} from "@/lib/appointments/time";
import type { Lead } from "@/lib/types";
import { cn, formatAddress } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The dialog that finally asks a rep WHEN.
//
// Before this, a rep clicking "Appointment booked" filed a disposition with no
// time on it at all: `scheduled_at` was NULL, the appointment landed in a "later"
// bucket, and it could never appear on a calendar. Every rep-booked review in the
// system was invisible to the thing meant to show it. Fixing that is what makes
// the calendar real rather than a grid of AI proposals.
//
// It is deliberately skippable. A rep on a live call who agreed to "sometime next
// week" should not be blocked by a form — Skip reproduces the old behavior exactly
// and the booking shows up in the calendar's "Needs a time" rail to be pinned
// later. The one thing we never do is silently invent a time nobody agreed to.
//
// This opens BEFORE the disposition is filed, because filing it advances the
// queue and can auto-dial the next lead (use-dialer.ts selectOutcome) — a dialog
// that opened afterwards would be attached to a call that had already moved on.
// ─────────────────────────────────────────────────────────────────────────────

export interface BookedAppointment {
  when: string;
  iso: string;
  notes: string;
  durationMin: number;
  location: string;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

/** Tomorrow, 6pm — when most homeowners are actually home. */
function defaultSlot(): Date {
  const d = startOfDay(addDays(new Date(), 1));
  d.setHours(18, 0, 0, 0);
  return d;
}

/** One tap for the times reps actually book. */
function quickSlots(): { label: string; at: Date }[] {
  const mk = (days: number, hour: number) => {
    const d = startOfDay(addDays(new Date(), days));
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  return [
    { label: "Today 6pm", at: mk(0, 18) },
    { label: "Tomorrow 6pm", at: mk(1, 18) },
    { label: "Tomorrow 7pm", at: mk(1, 19) },
    { label: "In 2 days, 6pm", at: mk(2, 18) },
  ];
}

export function BookAppointmentDialog({
  lead,
  defaultNotes,
  onConfirm,
  onSkip,
  onCancel,
}: {
  lead: Lead;
  defaultNotes?: string;
  onConfirm: (appt: BookedAppointment) => void;
  /** Book it with no time — exactly what every rep booking did before today. */
  onSkip: () => void;
  /** Backed out entirely: no appointment, no disposition. */
  onCancel: () => void;
}) {
  const address = useMemo(() => formatAddress(lead), [lead]);

  const [when, setWhen] = useState(() => toDateTimeInput(defaultSlot()));
  const [durationMin, setDurationMin] = useState(DEFAULT_DURATION_MIN);
  const [location, setLocation] = useState(address);
  const [notes, setNotes] = useState(defaultNotes ?? "");

  const start = useMemo(() => (when ? parseFloating(`${when}:00`) : null), [when]);
  const slots = useMemo(quickSlots, []);

  const inPast = start ? start.getTime() < Date.now() - 60_000 : false;

  function confirm() {
    if (!start) return;
    onConfirm({
      // The floating wall clock, offset-less on purpose — see appointments/time.ts.
      iso: `${when}:00`,
      when: `${formatDayLabel(start)} · ${formatRange(start, durationMin)}`,
      notes: notes.trim(),
      durationMin,
      location: location.trim(),
    });
  }

  return (
    <Modal onClose={onCancel} label="Book the account review" maxWidth="max-w-md">
      <div className="flex items-start gap-3 border-b border-border/60 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
          <CalendarCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">Book the account review</h2>
          <p className="truncate text-sm text-muted-foreground">
            {lead.firstName} {lead.lastName}
            {lead.city ? ` · ${lead.city}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 overflow-y-auto p-5">
        <div>
          <Label>Quick slots</Label>
          <div className="grid grid-cols-2 gap-2">
            {slots.map((s) => {
              const value = toDateTimeInput(s.at);
              const selected = when === value;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setWhen(value)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-surface text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="book-when">When</Label>
            <input
              id="book-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-xl border border-input bg-background/40 px-3.5 py-2.5 text-sm transition-all duration-200 focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
            />
          </div>
          <div>
            <Label htmlFor="book-duration">Duration</Label>
            <Select
              id="book-duration"
              value={String(durationMin)}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d < 60 ? `${d} min` : d === 60 ? "1 hour" : `${d / 60} hours`}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {start && (
          <p
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium",
              inPast ? "bg-warning/15 text-warning" : "bg-muted/60 text-muted-foreground",
            )}
          >
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {inPast
              ? `That's in the past — ${formatDayLabel(start)}, ${formatRange(start, durationMin)}`
              : `${formatDayLabel(start)} · ${formatRange(start, durationMin)}`}
          </p>
        )}

        <div>
          <Label htmlFor="book-location">Location</Label>
          <Input
            id="book-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Where is the review?"
          />
          {address && location !== address && (
            <button
              type="button"
              onClick={() => setLocation(address)}
              className="mt-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <MapPin className="h-3 w-3" /> Use the home address
            </button>
          )}
        </div>

        <div>
          <Label htmlFor="book-notes">Notes</Label>
          <Textarea
            id="book-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did they agree to? Anything the closer should know…"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 p-4">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          No time agreed
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Back
          </Button>
          <Button variant="success" size="sm" onClick={confirm} disabled={!start} className="gap-1.5">
            <CalendarCheck className="h-3.5 w-3.5" /> Book it
          </Button>
        </div>
      </div>
    </Modal>
  );
}
