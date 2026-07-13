"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Clock,
  Loader2,
  MailWarning,
  MapPin,
  Phone,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { OutcomeGrid } from "@/components/dialer/outcome-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Portal } from "@/components/ui/portal";
import { conflictsAt, type ConflictCandidate } from "@/lib/appointments/conflicts";
import {
  DEFAULT_DURATION_MIN,
  formatDayLabel,
  formatRange,
  formatTime,
  parseFloating,
  toDateTimeInput,
} from "@/lib/appointments/time";
import type { AppointmentRow } from "@/lib/db/pipeline";
import type { CallOutcome } from "@/lib/types";
import { cn, formatPhone, initials } from "@/lib/utils";
import { type ApptAccess, isReview, STATUS_OPTIONS } from "./shared";

export interface AppointmentPatch {
  scheduledAt?: string | null;
  scheduledLabel?: string;
  durationMin?: number;
  location?: string;
  notes?: string;
  assignedTo?: string;
  approve?: boolean;
}

export interface CreateDraft {
  scheduledAt: string | null;
  leadName?: string;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

export interface RepOption {
  id: string;
  name: string;
}

/**
 * One dialog for the whole lifecycle of an appointment: propose → approve → move
 * → hold → cancel. It is also the create form (`appt` is null, `draft` carries
 * the slot the user clicked). Keeping them one component means the conflict
 * warning, the duration picker and the assignee selector can't drift apart
 * between "new" and "edit", which is exactly how calendars end up with two
 * subtly different booking forms.
 */
export function AppointmentDialog({
  appt,
  draft,
  siblings,
  access,
  reps,
  busy,
  reduce,
  onClose,
  onCreate,
  onSave,
  onApprove,
  onStatus,
  onCancel,
  onDelete,
  onRoute,
  onRetryNotification,
}: {
  appt: AppointmentRow | null;
  draft: CreateDraft | null;
  /** Everything else on the calendar — what we check the chosen slot against. */
  siblings: ConflictCandidate[];
  access: ApptAccess;
  reps: RepOption[];
  busy: boolean;
  reduce: boolean;
  onClose: () => void;
  onCreate: (input: {
    leadName: string;
    scheduledAt: string | null;
    scheduledLabel: string;
    durationMin: number;
    location: string;
    notes: string;
    assignedTo: string;
  }) => void;
  onSave: (id: string, patch: AppointmentPatch) => void;
  onApprove: (id: string) => void;
  onStatus: (id: string, status: string) => void;
  onCancel: (id: string, reason: string) => void;
  onDelete: (id: string) => void;
  onRoute: (leadId: string, outcome: CallOutcome) => void;
  onRetryNotification: (id: string) => void;
}) {
  const creating = !appt;
  const review = appt ? isReview(appt) : false;
  const readOnly = !access.canManage;

  const [when, setWhen] = useState(() => {
    const initial = appt ? appt.scheduledAt : (draft?.scheduledAt ?? null);
    const d = parseFloating(initial);
    return d ? toDateTimeInput(d) : "";
  });
  const [durationMin, setDurationMin] = useState(appt?.durationMin || DEFAULT_DURATION_MIN);
  const [leadName, setLeadName] = useState(draft?.leadName ?? "");
  const [location, setLocation] = useState(appt?.location ?? "");
  const [notes, setNotes] = useState(appt?.notes ?? "");
  const [status, setStatus] = useState(appt?.status || "scheduled");
  const [assignedTo, setAssignedTo] = useState(appt?.assignedTo ?? access.meId ?? "");

  const [mode, setMode] = useState<"edit" | "route" | "cancel" | "delete">("edit");
  const [cancelReason, setCancelReason] = useState("");

  const startDate = useMemo(() => (when ? parseFloating(`${when}:00`) : null), [when]);

  // Recomputed on every keystroke: the answer to "is this rep already busy then?"
  // has to arrive while you're picking the time, not after you've saved.
  const conflicts = useMemo(() => {
    if (!startDate) return [];
    return conflictsAt(
      { id: appt?.id ?? "new", assignee: assignedTo || access.meId },
      startDate,
      durationMin,
      siblings,
    );
  }, [startDate, durationMin, assignedTo, access.meId, appt?.id, siblings]);

  function labelFor(d: Date | null): string {
    return d ? `${formatDayLabel(d)} · ${formatRange(d, durationMin)}` : "";
  }

  function submitCreate() {
    onCreate({
      leadName: leadName.trim() || "Homeowner",
      scheduledAt: startDate ? `${when}:00` : null,
      scheduledLabel: labelFor(startDate),
      durationMin,
      location: location.trim(),
      notes: notes.trim(),
      assignedTo: assignedTo || access.meId || "",
    });
  }

  function submitSave(approve: boolean) {
    if (!appt) return;
    const patch: AppointmentPatch = {};
    const original = parseFloating(appt.scheduledAt);
    const originalInput = original ? toDateTimeInput(original) : "";

    if (when !== originalInput) {
      patch.scheduledAt = when ? `${when}:00` : null;
      // The label is what humans read when there's no timestamp; keep them agreeing.
      patch.scheduledLabel = labelFor(startDate);
    }
    if (durationMin !== appt.durationMin) patch.durationMin = durationMin;
    if (location !== (appt.location ?? "")) patch.location = location;
    if (notes !== (appt.notes ?? "")) patch.notes = notes;
    if (assignedTo && assignedTo !== appt.assignedTo) patch.assignedTo = assignedTo;
    if (approve) patch.approve = true;

    if (Object.keys(patch).length === 0) {
      if (approve) onApprove(appt.id);
      else onClose();
      return;
    }
    onSave(appt.id, patch);
  }

  const title = creating ? "New appointment" : appt!.leadName;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-background/70 backdrop-blur-xl"
          onClick={onClose}
        />
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="glass relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border/60 shadow-lift sm:rounded-2xl"
        >
          {/* Header */}
          <div className="flex items-start gap-3 border-b border-border/60 p-5">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-semibold",
                review ? "bg-warning/15 text-warning" : "bg-accent-soft text-accent",
              )}
            >
              {creating ? (
                <Clock className="h-5 w-5" />
              ) : appt!.source === "ai" ? (
                <Sparkles className="h-5 w-5" />
              ) : (
                initials(appt!.leadName)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-semibold">{title}</h2>
                {!creating && appt!.source === "ai" && (
                  <Badge tone="accent" className="gap-1">
                    <Sparkles className="h-3 w-3" /> AI
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {creating
                  ? "Book a review that has no call behind it."
                  : review
                    ? "AI proposal — review to confirm"
                    : readOnly
                      ? "You have read-only access to this calendar."
                      : startDate
                        ? `${formatDayLabel(startDate)} · ${formatRange(startDate, durationMin)}`
                        : "No time set"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {busy ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : mode === "delete" && appt ? (
            <div className="p-5">
              <p className="mb-1 text-base font-semibold">Delete this appointment?</p>
              <p className="mb-5 text-sm text-muted-foreground">
                This removes it entirely, with no record it ever existed. If the review was simply
                called off, <span className="font-medium text-foreground">cancel</span> it instead —
                that keeps the history and tells the recipient it&apos;s off.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setMode("edit")}>
                  Back
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onDelete(appt.id)}
                  className="gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete permanently
                </Button>
              </div>
            </div>
          ) : mode === "cancel" && appt ? (
            <div className="p-5">
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="mb-3 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
              <p className="mb-1 text-base font-semibold">Cancel this appointment</p>
              <p className="mb-4 text-sm text-muted-foreground">
                It stays on the calendar, struck through, so the day still tells the truth. Anyone
                on the notification list is told it&apos;s off.
              </p>
              <Label htmlFor="cancel-reason">Reason</Label>
              <Input
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Homeowner rescheduled, wrong number…"
              />
              <div className="mt-4 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setMode("edit")}>
                  Keep it
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onCancel(appt.id, cancelReason.trim())}
                >
                  Cancel appointment
                </Button>
              </div>
            </div>
          ) : mode === "route" && appt ? (
            <div className="p-5">
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="mb-3 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
              <p className="mb-1 text-base font-semibold">Route this lead back</p>
              <p className="mb-4 text-sm text-muted-foreground">
                Override the appointment and re-file the lead under another disposition.
              </p>
              {appt.leadId ? (
                <OutcomeGrid onSelect={(o) => onRoute(appt.leadId!, o)} />
              ) : (
                <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                  No lead is linked to this appointment, so it can&apos;t be re-dispositioned.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* The email that never arrived, attached to the thing it was about. */}
              {appt?.notifyStatus === "failed" && (
                <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3">
                  <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-danger">
                      The notification for this appointment never sent.
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      It ran out of retries. Fix the email settings, then try again.
                    </p>
                  </div>
                  {access.canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRetryNotification(appt.id)}
                      className="shrink-0"
                    >
                      Retry
                    </Button>
                  )}
                </div>
              )}

              {/* Context chips */}
              {!creating && (
                <div className="flex flex-wrap gap-2 px-5 pt-4">
                  {appt!.phone && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-medium">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />{" "}
                      {formatPhone(appt!.phone)}
                    </span>
                  )}
                  {appt!.address && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-medium">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {appt!.address}
                    </span>
                  )}
                  {access.canTeam && appt!.repName && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-medium">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" /> {appt!.repName}
                    </span>
                  )}
                  {appt!.rescheduleCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
                      <RotateCcw className="h-3.5 w-3.5" /> Moved {appt!.rescheduleCount}×
                    </span>
                  )}
                </div>
              )}

              <div className="space-y-4 p-5">
                {creating && (
                  <div>
                    <Label htmlFor="appt-lead">Homeowner</Label>
                    <Input
                      id="appt-lead"
                      value={leadName}
                      onChange={(e) => setLeadName(e.target.value)}
                      placeholder="Who is the review with?"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="appt-when">When</Label>
                    <input
                      id="appt-when"
                      type="datetime-local"
                      value={when}
                      disabled={readOnly}
                      onChange={(e) => setWhen(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background/40 px-3.5 py-2.5 text-sm transition-all duration-200 focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:opacity-60"
                    />
                    {!when && appt?.scheduledLabel && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Agreed as “{appt.scheduledLabel}” — set an exact time to put it on the
                        calendar.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="appt-duration">Duration</Label>
                    <Select
                      id="appt-duration"
                      value={String(durationMin)}
                      disabled={readOnly}
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

                {conflicts.length > 0 && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-danger">
                        Double-booked — this rep is already busy then.
                      </p>
                      <ul className="mt-0.5 space-y-0.5">
                        {conflicts.slice(0, 3).map((c) => (
                          <li key={c.id} className="truncate text-[11px] text-muted-foreground">
                            {formatTime(new Date(c.start))} — {c.label}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        You can still save it; this is a warning, not a block.
                      </p>
                    </div>
                  </div>
                )}

                {access.canTeam && reps.length > 0 && (
                  <div>
                    <Label htmlFor="appt-rep">Assigned to</Label>
                    <Select
                      id="appt-rep"
                      value={assignedTo}
                      disabled={readOnly}
                      onChange={(e) => setAssignedTo(e.target.value)}
                    >
                      {reps.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

                <div>
                  <Label htmlFor="appt-location">Location</Label>
                  <Input
                    id="appt-location"
                    value={location}
                    disabled={readOnly}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={appt?.address || "Where is the review?"}
                  />
                </div>

                {!creating && !review && (
                  <div>
                    <Label htmlFor="appt-status">Status</Label>
                    <Select
                      id="appt-status"
                      value={status}
                      disabled={readOnly}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

                <div>
                  <Label htmlFor="appt-notes">Notes</Label>
                  <Textarea
                    id="appt-notes"
                    value={notes}
                    disabled={readOnly}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add context for whoever runs this review…"
                  />
                </div>
              </div>

              {/* Footer */}
              {!readOnly && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 p-4">
                  {!creating && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMode("route")}
                        className="gap-1.5"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Route back
                      </Button>
                      {appt!.status !== "cancelled" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMode("cancel")}
                          className="gap-1.5 text-danger hover:bg-danger/10 hover:text-danger"
                        >
                          <X className="h-3.5 w-3.5" /> Cancel
                        </Button>
                      )}
                      <button
                        type="button"
                        onClick={() => setMode("delete")}
                        className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-danger"
                      >
                        Delete
                      </button>
                    </>
                  )}

                  <div className="ml-auto flex items-center gap-2">
                    {creating ? (
                      <Button variant="primary" size="sm" onClick={submitCreate}>
                        Book appointment
                      </Button>
                    ) : review ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => submitSave(false)}>
                          Save edits
                        </Button>
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => submitSave(true)}
                          className="gap-1.5"
                        >
                          <Check className="h-3.5 w-3.5" /> Approve
                        </Button>
                      </>
                    ) : (
                      <>
                        {status !== appt!.status && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onStatus(appt!.id, status)}
                          >
                            Update status
                          </Button>
                        )}
                        <Button variant="primary" size="sm" onClick={() => submitSave(false)}>
                          Save changes
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      </div>
    </Portal>
  );
}
