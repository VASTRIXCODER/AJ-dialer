import type { CallOutcome } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Power-mode pending dispositions.
//
// In power mode a finished manual call does NOT stop the dialer for the rep to
// disposition it. Instead a snapshot of the call becomes a "pending
// disposition" that the AI classifies in the background; it either auto-applies
// (auto-confirm on) or waits in a review widget while the dialer keeps going.
//
// This module is PURE data + helpers (client- and test-safe). The live list is
// held in the dialer client and mirrored to localStorage so a page reload
// doesn't lose calls a rep hasn't reviewed yet.
// ─────────────────────────────────────────────────────────────────────────────

export type PendingState = "classifying" | "suggested" | "applied" | "error";

export interface PendingDisposition {
  /** Stable id for this pending row (not the lead id — a lead can be dialed twice). */
  id: string;
  leadId: string;
  leadName: string;
  phone: string;
  durationSec: number;
  /** True when the call actually connected (had talk time) — drives the AI's
   *  read and lets a never-answered call skip straight to "no answer". */
  connected: boolean;
  callSid: string | null;
  room: string | null;
  /** Rep notes captured at the moment the call ended. */
  notes: string;
  scriptVariant: "a" | "b" | null;
  /** The dial-time idempotency key for this attempt (from `state.attemptIds`),
   *  so a replayed save is a no-op server-side instead of a duplicate record. */
  clientAttemptId: string | null;
  /** A claimed callback this call executed — completed when the disposition
   *  lands (consume-once; only the first call of a callback visit carries it). */
  callbackId: string | null;
  createdAt: number;
  state: PendingState;
  /** The AI's suggested disposition, once classification returns. */
  suggestedOutcome: CallOutcome | null;
  summary: string | null;
  /** 0-100 when the model scores its read. */
  confidence: number | null;
  /** The outcome actually filed (auto-applied, or confirmed/overridden by the rep). */
  appliedOutcome: CallOutcome | null;
  autoApplied: boolean;
  error: string | null;
}

/**
 * Outcomes that must NEVER be auto-applied, even with auto-confirm on: they
 * need a human to set a time (an appointment slot, a callback due date), and no
 * model guess is a good enough reason to write a booking onto a homeowner's
 * calendar. They always wait in the widget, where confirming opens the time
 * dialog. Everything else is safe to auto-file.
 */
export const NEEDS_TIME: CallOutcome[] = ["appointment_booked", "callback_scheduled"];

export function needsTime(outcome: CallOutcome | null | undefined): boolean {
  return outcome != null && NEEDS_TIME.includes(outcome);
}

/** May this suggested outcome be auto-applied under auto-confirm? */
export function isAutoConfirmable(outcome: CallOutcome | null | undefined): boolean {
  return outcome != null && !needsTime(outcome);
}

/** localStorage key for a rep's un-reviewed pending dispositions. */
export function pendingStorageKey(userId: string | null | undefined): string | null {
  return userId ? `aj:pendingDispositions:${userId}` : null;
}

/** Rows still needing the rep's eyes — the widget's actionable stack. Applied
 *  rows are done and drop out of the count. */
export function unreviewed(list: PendingDisposition[]): PendingDisposition[] {
  return list.filter((p) => p.state !== "applied");
}
