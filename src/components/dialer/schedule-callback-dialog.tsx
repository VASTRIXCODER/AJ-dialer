"use client";

import { Clock, PhoneMissed, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  addDays,
  formatDayLabel,
  formatTime,
  parseFloating,
  startOfDay,
  toDateTimeInput,
} from "@/lib/appointments/time";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The dialog that finally asks a rep WHEN to call back.
//
// "Callback scheduled" scheduled nothing. routeDisposition inserted a callbacks
// row with `status: 'due'` and no `due_at` at all, so the Callbacks page's
// Overdue / Due now / Upcoming triage was decorative: every callback a rep ever
// promised landed in "Due now" and stayed there forever, whether it was agreed
// for this afternoon or for next month. Reps promised times the product had no
// way to remember.
//
// Same shape and same rules as the appointment dialog: it opens BEFORE the
// disposition is filed (filing advances the queue and can auto-dial the next
// lead), and it is skippable — a rep told "call me sometime next week" isn't
// blocked by a form, the callback just lands with no time exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduledCallback {
  /** Floating wall-clock ("2026-06-23T18:00:00") — see appointments/time.ts. */
  iso: string;
  /** Human label, kept for the reason line and any email. */
  when: string;
  reason: string;
}

/** Two hours from now, snapped to the next quarter hour. */
function defaultSlot(): Date {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

/** The gaps reps actually promise, one tap each. */
function quickSlots(): { label: string; at: Date }[] {
  const inHours = (h: number) => {
    const d = new Date(Date.now() + h * 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return d;
  };
  const at = (days: number, hour: number) => {
    const d = startOfDay(addDays(new Date(), days));
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  return [
    { label: "In 1 hour", at: inHours(1) },
    { label: "In 3 hours", at: inHours(3) },
    { label: "Tomorrow 10am", at: at(1, 10) },
    { label: "Tomorrow 5pm", at: at(1, 17) },
    { label: "In 3 days", at: at(3, 10) },
    { label: "Next week", at: at(7, 10) },
  ];
}

export function ScheduleCallbackDialog({
  lead,
  defaultReason,
  onConfirm,
  onSkip,
  onCancel,
}: {
  /** Only the display fields — the Callbacks board reschedules rows that
   *  don't have a full Lead in hand (a full Lead still satisfies this). */
  lead: Pick<Lead, "firstName" | "lastName" | "city">;
  /** Prefilled from the rep's in-call notes — usually already the reason. */
  defaultReason?: string;
  onConfirm: (cb: ScheduledCallback) => void;
  /** File the callback with no time — the pre-existing behavior. */
  onSkip: () => void;
  /** Backed out entirely: no callback, no disposition. */
  onCancel: () => void;
}) {
  const vocab = useVocabulary();
  const [when, setWhen] = useState(() => toDateTimeInput(defaultSlot()));
  const [reason, setReason] = useState(defaultReason?.trim() ?? "");

  const start = useMemo(() => (when ? parseFloating(`${when}:00`) : null), [when]);
  const slots = useMemo(quickSlots, []);
  const inPast = start ? start.getTime() < Date.now() - 60_000 : false;

  function confirm() {
    if (!start) return;
    onConfirm({
      iso: `${when}:00`,
      when: `${formatDayLabel(start)} · ${formatTime(start)}`,
      reason: reason.trim(),
    });
  }

  return (
    <Modal onClose={onCancel} label="Schedule the callback" maxWidth="max-w-md">
      <div className="flex items-start gap-3 border-b border-border/60 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <PhoneMissed className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">Schedule the callback</h2>
          <p className="truncate text-sm text-muted-foreground">
            {`${lead.firstName} ${lead.lastName}`.trim() || `This ${vocab.leadNoun}`}
            {lead.city ? ` · ${lead.city}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div>
          <Label>When did they ask you to call back?</Label>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {slots.map((s) => {
              const value = toDateTimeInput(s.at);
              const active = value === when;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setWhen(value)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                    active
                      ? "border-warning/60 bg-warning/10 text-warning"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          {start && (
            <p
              className={cn(
                "mt-1.5 flex items-center gap-1.5 text-xs",
                inPast ? "font-medium text-warning" : "text-muted-foreground",
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              {inPast
                ? "That's in the past — it'll show as overdue straight away."
                : `${formatDayLabel(start)} at ${formatTime(start)}`}
            </p>
          )}
        </div>

        <div>
          <Label>What should you say?</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Asked to talk after speaking to their partner…"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Shown on the Callbacks board so whoever picks it up knows the context.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 p-5 sm:flex-row">
        <Button
          variant="ghost"
          className="sm:flex-1"
          onClick={onSkip}
          title="File the callback without a time — it lands in 'Due now'."
        >
          No time agreed
        </Button>
        <Button className="gap-2 sm:flex-1" disabled={!start} onClick={confirm}>
          <PhoneMissed className="h-4 w-4" />
          Schedule callback
        </Button>
      </div>
    </Modal>
  );
}
