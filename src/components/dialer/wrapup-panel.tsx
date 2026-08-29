"use client";

import { Flag, NotebookPen, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AiCallSummary } from "@/components/ai/call-summary";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  browserWrapupStore,
  readWrapupDraft,
  saveWrapupDraft,
} from "@/lib/dialer/wrapup-draft";
import type { CallOutcome, Lead } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { OutcomeGrid } from "./outcome-grid";

// ─────────────────────────────────────────────────────────────────────────────
// WrapupPanel (E3) — the one wrap-up surface, consolidated out of call-stage /
// dialer-client. Renders the org's disposition taxonomy (campaign-narrowed),
// the rep's notes (same note the qualify panel edits), the AI summary, a
// crash-safe draft (localStorage keyed by the attempt's client id — restored
// if the tab dies mid-wrap-up, cleared when the disposition files), and a
// [Flag for review] escalation into call_review_queue (the review UI lands in
// F1). The appointment/callback dialogs stay with the conductor — this panel
// only fires onOutcome, exactly as the old inline block did.
// ─────────────────────────────────────────────────────────────────────────────

export function WrapupPanel({
  leadName,
  lead,
  durationSec,
  attemptId,
  notes,
  onNotesChange,
  onOutcome,
  dispositions,
  allowedKeys,
  onRedial,
  onSkip,
  reviewEnabled,
}: {
  leadName: string;
  lead: Lead | null;
  durationSec: number;
  /** This attempt's client idempotency id — keys the draft; null = no draft. */
  attemptId: string | null;
  notes?: string;
  onNotesChange?: (notes: string) => void;
  /** Canonical outcome + the disposition-def key actually pressed. */
  onOutcome: (o: CallOutcome, dispositionKey?: string) => void;
  /** The org's stored `settings.dispositions` (absent ⇒ the canonical nine). */
  dispositions?: unknown;
  /** Campaign `disposition_keys` subset (empty/absent = all). */
  allowedKeys?: string[];
  onRedial: () => void;
  onSkip: () => void;
  /** False in demo mode — the flag button then renders disabled with a reason. */
  reviewEnabled: boolean;
}) {
  const { toast } = useToast();
  const store = useMemo(() => browserWrapupStore(), []);
  const [flagState, setFlagState] = useState<"idle" | "sending" | "flagged">("idle");

  // ── Draft: restore once per attempt, only into EMPTY notes ────────────────
  // The lead's saved note seeds `notes` on lead change; a crash-recovered
  // draft must never clobber text the rep can already see — it fills silence.
  const restoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!store || !attemptId || restoredForRef.current === attemptId) return;
    restoredForRef.current = attemptId;
    if (!notes) {
      const draft = readWrapupDraft(store, attemptId);
      if (draft?.notes) onNotesChange?.(draft.notes);
    }
    // Restore exactly once per attempt id, at mount of that attempt's wrap-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, attemptId]);

  // ── Draft: autosave on a 2s debounce while typing ─────────────────────────
  useEffect(() => {
    if (!store || !attemptId) return;
    const t = setTimeout(() => saveWrapupDraft(store, attemptId, notes ?? ""), 2000);
    return () => clearTimeout(t);
  }, [notes, store, attemptId]);

  const flagForReview = async () => {
    if (flagState !== "idle") return;
    setFlagState("sending");
    try {
      const res = await fetch("/api/calls/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: lead?.id,
          clientAttemptId: attemptId ?? undefined,
          reason: "rep_flagged",
          note: notes?.slice(0, 1000) || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "flag failed");
      setFlagState("flagged");
      toast({
        title: "Flagged for review",
        tone: "success",
        description: "This call is in the review queue for a supervisor.",
      });
    } catch {
      setFlagState("idle");
      toast({
        title: "Couldn't flag this call",
        tone: "danger",
        description: "Try again in a moment.",
      });
    }
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="text-center">
        <h2 className="text-lg font-bold">Disposition this call</h2>
        <p className="text-sm text-muted-foreground">
          {leadName} · {formatDuration(durationSec)} talk time
        </p>
      </div>

      {/* The wrap-up copilot: an actionable, org-taxonomy-aware disposition
          suggestion (clicking it files through the SAME onOutcome the grid
          uses, appointment/callback dialogs included). */}
      <AiCallSummary
        leadId={lead?.id ?? null}
        notes={notes}
        durationSec={durationSec}
        allowedKeys={allowedKeys}
        onPick={onOutcome}
      />

      {/* Notes belong HERE, at the moment the rep is judging the call — the
          same note the qualify panel edits; the value is owned by the page. */}
      {onNotesChange && (
        <div>
          <label
            htmlFor="wrapup-notes"
            className="mb-1.5 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <NotebookPen className="h-3.5 w-3.5" />
              Notes
            </span>
            <span className="font-medium normal-case tracking-normal text-muted-foreground/70">
              Saved with the disposition
            </span>
          </label>
          <Textarea
            id="wrapup-notes"
            data-dialer-notes
            value={notes ?? ""}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="What happened, what they said, what to do next…"
            className="min-h-[72px]"
          />
        </div>
      )}

      <OutcomeGrid onSelect={onOutcome} dispositions={dispositions} allowedKeys={allowedKeys} />

      <div className="flex gap-2">
        {/* Redial the SAME contact right now — DND setups often let a quick
            repeat call through. Pins the same caller ID; files no disposition
            (see redial() in use-dialer.ts). */}
        <Button variant="outline" className="flex-1 gap-2" onClick={onRedial}>
          <RotateCcw className="h-4 w-4" />
          Dial again
        </Button>
        <Button
          variant="ghost"
          className="flex-1 gap-2 text-muted-foreground"
          onClick={onSkip}
          title="Skip without a disposition (.)"
        >
          <SkipForward className="h-4 w-4" />
          Skip without disposition
        </Button>
      </div>

      {/* Escalation: put this call in front of a supervisor. The review lane
          UI ships in F1; the row lands in call_review_queue today. */}
      <button
        type="button"
        onClick={flagForReview}
        disabled={!reviewEnabled || flagState !== "idle"}
        title={
          !reviewEnabled
            ? "Flagging needs a connected database — not available in this setup."
            : flagState === "flagged"
              ? "Already flagged — a supervisor will review this call."
              : "Send this call to the supervisor review queue."
        }
        className="mx-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors enabled:hover:text-warning disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Flag className="h-3.5 w-3.5" />
        {flagState === "flagged"
          ? "Flagged for review"
          : flagState === "sending"
            ? "Flagging…"
            : "Flag for review"}
      </button>
    </div>
  );
}
