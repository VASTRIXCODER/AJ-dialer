"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BookedAppointment } from "@/components/dialer/book-appointment-dialog";
import type { ScheduledCallback } from "@/components/dialer/schedule-callback-dialog";
import type { CallOutcome } from "@/lib/types";
import { persistDisposition } from "./disposition-queue";
import {
  isAutoConfirmable,
  needsTime,
  pendingStorageKey,
  type PendingDisposition,
} from "./pending-dispositions";

/** Everything captured about a finished call at the moment it ended. */
export interface CallSnapshot {
  leadId: string;
  leadName: string;
  phone: string;
  durationSec: number;
  connected: boolean;
  callSid: string | null;
  room: string | null;
  notes: string;
  scriptVariant: "a" | "b" | null;
  /** Dial-time idempotency key for this attempt (from `state.attemptIds`). */
  clientAttemptId: string | null;
  /** A claimed callback this call executed (consume-once). */
  callbackId: string | null;
  /** Present for AI calls (which already carry one); absent for manual calls
   *  until STT lands. Forwarded to the classifier when it exists. */
  transcript?: string;
}

const MAX_ROWS = 40;

/**
 * Power-mode disposition pipeline. Owns the review stack, classifies each
 * finished call against the AI, and — when auto-confirm is on — files the safe
 * outcomes itself. Appointments and callbacks never auto-file: they need a human
 * to set a time, so they wait in the widget and confirming opens the dialog
 * (via `onNeedsTime`).
 *
 * Nothing here advances the dialer — the caller already kept it dialing. This is
 * purely the "what did that call turn out to be, and did we file it" side.
 */
export function usePendingDispositions({
  userId,
  autoConfirm,
  onNeedsTime,
}: {
  userId?: string;
  autoConfirm: boolean;
  /** A suggested appointment/callback the rep confirmed — open the time dialog.
   *  The dialog then calls `applyWithTime` to persist + close the row. */
  onNeedsTime: (row: PendingDisposition, outcome: CallOutcome) => void;
}) {
  const [pending, setPending] = useState<PendingDisposition[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Auto-confirm can be toggled AFTER a call is sent to classify but BEFORE the
  // answer returns — read the live value at resolution time, not enqueue time.
  const autoConfirmRef = useRef(autoConfirm);
  autoConfirmRef.current = autoConfirm;

  const patchRow = useCallback((id: string, patch: Partial<PendingDisposition>) => {
    setPending((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  /** Build the /api/calls payload for a row and file it durably (queues on
   *  failure, never lost). Does NOT touch the dialer queue. */
  const fileRow = useCallback(
    (
      row: PendingDisposition,
      outcome: CallOutcome,
      extra?: { appointment?: BookedAppointment | null; callback?: ScheduledCallback | null },
    ) => {
      void persistDisposition({
        leadId: row.leadId,
        leadName: row.leadName,
        phone: row.phone,
        durationSec: row.durationSec,
        outcome,
        // The AI has no custom taxonomy key — file under the canonical outcome.
        dispositionKey: outcome,
        callSid: row.callSid,
        room: row.room,
        // Idempotency + callback-completion, captured when the call ended.
        clientAttemptId: row.clientAttemptId ?? undefined,
        callbackId: row.callbackId ?? undefined,
        notes: row.notes || undefined,
        appointment: extra?.appointment ?? undefined,
        callback: extra?.callback ?? undefined,
        scriptVariant: row.scriptVariant ?? undefined,
      });
    },
    [],
  );

  /** Ask the model what this call was, then either auto-file it or leave it for
   *  the rep. Idempotent per row id (used by both enqueue and retry). */
  const classify = useCallback(
    async (row: PendingDisposition) => {
      patchRow(row.id, { state: "classifying", error: null });
      try {
        const res = await fetch("/api/calls/classify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leadId: row.leadId,
            durationSec: row.durationSec,
            notes: row.notes || undefined,
            transcript: undefined,
            connected: row.connected,
          }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          outcome?: CallOutcome | null;
          summary?: string;
          confidence?: number | null;
        };
        if (!alive.current) return;
        if (!res.ok || !j.ok || !j.outcome) {
          patchRow(row.id, { state: "error", error: "Classification failed." });
          return;
        }
        const outcome = j.outcome;
        const base: Partial<PendingDisposition> = {
          suggestedOutcome: outcome,
          summary: j.summary ?? null,
          confidence: typeof j.confidence === "number" ? j.confidence : null,
        };
        // Auto-confirm files the safe outcomes on the rep's behalf. A booking or
        // callback always waits — no model guess writes a time onto a calendar.
        if (autoConfirmRef.current && isAutoConfirmable(outcome)) {
          fileRow(row, outcome);
          patchRow(row.id, {
            ...base,
            state: "applied",
            appliedOutcome: outcome,
            autoApplied: true,
          });
        } else {
          patchRow(row.id, { ...base, state: "suggested" });
        }
      } catch {
        if (alive.current) patchRow(row.id, { state: "error", error: "Classification failed." });
      }
    },
    [fileRow, patchRow],
  );

  /** A call just ended — snapshot it into the stack and start classifying. */
  const enqueue = useCallback(
    (snap: CallSnapshot) => {
      const row: PendingDisposition = {
        id: `${snap.leadId}:${snap.callSid ?? Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        leadId: snap.leadId,
        leadName: snap.leadName,
        phone: snap.phone,
        durationSec: snap.durationSec,
        connected: snap.connected,
        callSid: snap.callSid,
        room: snap.room,
        notes: snap.notes,
        scriptVariant: snap.scriptVariant,
        clientAttemptId: snap.clientAttemptId,
        callbackId: snap.callbackId,
        createdAt: Date.now(),
        state: "classifying",
        suggestedOutcome: null,
        summary: null,
        confidence: null,
        appliedOutcome: null,
        autoApplied: false,
        error: null,
      };
      setPending((list) => [...list, row].slice(-MAX_ROWS));
      void classify(row);
    },
    [classify],
  );

  /** Confirm from the widget — the suggested outcome or an override. Bookings and
   *  callbacks route to the time dialog; everything else files immediately. */
  const confirm = useCallback(
    (row: PendingDisposition, outcome: CallOutcome) => {
      if (needsTime(outcome)) {
        onNeedsTime(row, outcome);
        return;
      }
      fileRow(row, outcome);
      patchRow(row.id, { state: "applied", appliedOutcome: outcome, autoApplied: false });
    },
    [fileRow, onNeedsTime, patchRow],
  );

  /** Called by the time dialog once the rep sets an appointment/callback slot. */
  const applyWithTime = useCallback(
    (
      row: PendingDisposition,
      outcome: CallOutcome,
      extra: { appointment?: BookedAppointment | null; callback?: ScheduledCallback | null },
    ) => {
      fileRow(row, outcome, extra);
      patchRow(row.id, { state: "applied", appliedOutcome: outcome, autoApplied: false });
    },
    [fileRow, patchRow],
  );

  const dismiss = useCallback((id: string) => {
    setPending((list) => list.filter((p) => p.id !== id));
  }, []);

  const retry = useCallback(
    (id: string) => {
      setPending((list) => {
        const row = list.find((p) => p.id === id);
        if (row) void classify(row);
        return list;
      });
    },
    [classify],
  );

  const clearApplied = useCallback(() => {
    setPending((list) => list.filter((p) => p.state !== "applied"));
  }, []);

  // ── Persistence ────────────────────────────────────────────────────────────
  // Mirror the un-filed stack to localStorage so a reload doesn't lose calls the
  // rep hasn't reviewed. Applied rows are on the server already — they drop out.
  const storageKey = pendingStorageKey(userId);
  const restored = useRef(false);
  useEffect(() => {
    if (!storageKey || restored.current) return;
    restored.current = true;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const saved = raw ? (JSON.parse(raw) as PendingDisposition[]) : [];
      if (Array.isArray(saved) && saved.length) {
        // A row mid-classification when the tab closed has no live fetch to
        // resolve it — surface it as retryable rather than a stuck spinner.
        const rows = saved.map((r) =>
          r.state === "classifying" ? { ...r, state: "error" as const } : r,
        );
        setPending(rows);
      }
    } catch {
      /* storage disabled — the stack just won't survive a reload */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !restored.current) return;
    try {
      const keep = pending.filter((p) => p.state !== "applied");
      if (keep.length) window.localStorage.setItem(storageKey, JSON.stringify(keep));
      else window.localStorage.removeItem(storageKey);
    } catch {
      /* best-effort */
    }
  }, [pending, storageKey]);

  return { pending, enqueue, confirm, applyWithTime, dismiss, retry, clearApplied };
}
