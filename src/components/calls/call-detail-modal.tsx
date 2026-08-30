"use client";

import {
  Bot,
  CalendarCheck,
  ClipboardList,
  Download,
  ExternalLink,
  Loader2,
  NotebookPen,
  Pencil,
  Phone,
  Play,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AiSourceBadge } from "@/components/ai/source-badge";
import { useVocabulary } from "@/components/layout/vocabulary";
import { LeadOpenLink } from "@/components/leads/lead-360/lead-open-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import type { ArchiveCall, ArchiveCallDetail } from "@/lib/db/call-archive";
import { resolveOutcomeConfig } from "@/lib/status";
import {
  formatClock,
  formatDay,
  formatDuration,
  formatPhone,
  initials,
  leadDisplayName,
} from "@/lib/utils";
import { TranscriptPanel } from "./transcript";
import { InlineEmpty } from "@/components/shared/empty-state";

type FullCall = ArchiveCallDetail;

// ─────────────────────────────────────────────────────────────────────────────
// ONE call-detail view, for both channels.
//
// There used to be two: an AI dashboard with a transcript, and a manual detail
// with no transcript section at all — so "where's the transcript?" had a
// different answer depending on which kind of call you happened to open, and
// neither could be reached except by clicking a row in one unfiltered list.
//
// This is the archive's detail read: everything the call left behind, in one
// place, all of it takeable (copy, download, open the lead).
// ─────────────────────────────────────────────────────────────────────────────

export function CallDetailModal({
  callId,
  /** Shown immediately while the full record (with transcript) loads. */
  preview,
  highlightTerm = "",
  onClose,
}: {
  callId: string;
  preview?: ArchiveCall;
  highlightTerm?: string;
  onClose: () => void;
}) {
  const vocab = useVocabulary();
  const [call, setCall] = useState<FullCall | null>(
    preview
      ? {
          ...preview,
          transcriptText: null,
          transcriptTurns: null,
          summaryMeta: null,
          canEditSummary: false,
        }
      : null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Audio ↔ transcript sync (F1): the <audio> ref lets a timestamped turn seek
  // the recording, and the playhead highlights the turn being spoken.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeSecs, setActiveSecs] = useState<number | null>(null);
  // Summary editing (supervisors) — supersedes the AI artifact server-side.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/calls/archive?id=${encodeURIComponent(callId)}`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { call: FullCall }) => setCall(j.call))
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [callId]);

  const seekTo = (secs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, secs);
    // Autoplay may be blocked — the seek still landed, which is the point.
    audio.play().catch(() => {});
  };

  const saveSummary = async () => {
    if (!call || saving) return;
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    setEditError("");
    try {
      const res = await fetch("/api/calls/summary", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callRecordId: call.id, text }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setEditError(j.error || "Couldn't save the edit.");
        return;
      }
      // Provenance flips locally the same way it did server-side: this summary
      // is now human-authored.
      setCall({
        ...call,
        summary: text,
        summaryMeta: {
          source: "human",
          model: null,
          createdAt: new Date().toISOString(),
          editorName: null,
        },
      });
      setEditing(false);
    } catch {
      setEditError("Couldn't save the edit.");
    } finally {
      setSaving(false);
    }
  };

  const cfg = call?.outcome ? resolveOutcomeConfig(vocab)[call.outcome] : null;
  // Only claim a name once we have a record. Without this the header flashed
  // "Unknown <noun>" for the length of the fetch on every open — which reads as
  // a broken record rather than as loading.
  const name = call
    ? leadDisplayName(call.leadName, call.phone, vocab.leadNoun)
    : "Loading call…";
  const isAI = call?.channel === "ai";
  const firstName = (call?.leadName ?? "").trim().split(" ")[0] || vocab.LeadNoun;
  const stamp = call?.startedAt ? new Date(call.startedAt) : null;
  const fileStamp = stamp
    ? stamp.toISOString().slice(0, 16).replace("T", "-").replace(":", "")
    : "call";

  return (
    <Modal onClose={onClose} label={`Call · ${name}`} maxWidth="max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={
              isAI
                ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-glow"
                : "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"
            }
          >
            {isAI ? <Bot className="h-5 w-5" /> : <User className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight">{name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[
                call?.phone ? formatPhone(call.phone) : null,
                isAI ? "AI call" : "Manual call",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={isAI ? "accent" : "neutral"} className="gap-1">
            {isAI ? <Bot className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
            {isAI ? "AI" : "Manual"}
          </Badge>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground">
        {call?.repName && (
          <span className="flex items-center gap-1.5">
            <Avatar initials={initials(call.repName)} seed={call.repName} size="xs" />
            <span className="font-medium text-foreground">{call.repName}</span>
          </span>
        )}
        {stamp && (
          <span className="tabular">
            {formatDay(call!.startedAt)} · {formatClock(call!.startedAt)}
          </span>
        )}
        {cfg && <Badge tone={cfg.tone}>{cfg.label}</Badge>}
        <span className="ml-auto font-mono text-sm font-bold tabular text-foreground">
          {call?.durationSec ? formatDuration(call.durationSec) : "—"}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {error && (
          <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        {call?.summary ? (
          <div className="rounded-xl border border-border/60 bg-surface/60 p-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <ClipboardList className="h-3.5 w-3.5" />
                Call summary
                {call.summaryMeta?.source === "ai" && <AiSourceBadge source="claude" />}
              </p>
              {call.canEditSummary && !editing && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(call.summary ?? "");
                    setEditing(true);
                    setEditError("");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              )}
            </div>
            {editing ? (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  className="w-full rounded-xl border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary"
                />
                {editError && (
                  <p className="text-xs font-medium text-danger">{editError}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveSummary}
                    disabled={saving || !draft.trim()}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed">{call.summary}</p>
            )}
            {/* Honest provenance: WHO wrote these words. AI output names its
                model and call date; a human edit names the editor instead. */}
            {call.summaryMeta && !editing && (
              <p className="mt-2 border-t border-border/40 pt-2 text-xs text-muted-foreground">
                {call.summaryMeta.source === "human"
                  ? `Edited by ${call.summaryMeta.editorName || "a supervisor"}`
                  : `AI-generated from the call on ${
                      stamp ? formatDay(call.startedAt) : "record"
                    }${call.summaryMeta.model ? ` · model ${call.summaryMeta.model}` : ""}`}
              </p>
            )}
          </div>
        ) : (
          !loading && (
            <InlineEmpty size="tight">
              No summary was generated for this call.
            </InlineEmpty>
          )
        )}

        {/* The rep's own notes — attached to THIS call, not the lead's rolling
            note field, so the wrap-up survives the next dial. */}
        {call?.notes && (
          <div className="rounded-xl border border-primary/25 bg-primary-soft/25 p-4">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
              <NotebookPen className="h-3.5 w-3.5" />
              Rep notes
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{call.notes}</p>
          </div>
        )}

        {call?.outcome === "appointment_booked" && (
          <Link
            href="/appointments"
            className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success transition-colors hover:bg-success/10"
          >
            <CalendarCheck className="h-4 w-4" />
            {vocab.appointmentNoun.charAt(0).toUpperCase() + vocab.appointmentNoun.slice(1)}{" "}
            booked — open the calendar
            <ExternalLink className="ml-auto h-3.5 w-3.5" />
          </Link>
        )}

        {loading && !call?.transcriptText && !call?.transcriptTurns?.length ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the transcript…
          </div>
        ) : call?.transcriptText || call?.transcriptTurns?.length ? (
          <TranscriptPanel
            text={call.transcriptText}
            // Stored per-turn timestamps make turns seek controls into the
            // recording; without them (manual/legacy calls) the panel renders
            // from the flat text with no seek affordance — the honest fallback.
            turns={call.transcriptTurns}
            onSeek={call.hasRecording && call.recordingUrl ? seekTo : undefined}
            activeSecs={activeSecs}
            contactLabel={firstName}
            highlightTerm={highlightTerm}
            filename={`transcript-${slug(name)}-${fileStamp}`}
          />
        ) : (
          <InlineEmpty size="tight">
            {isAI
              ? "No transcript — this call didn't reach a conversation."
              : // Say the true reason rather than leaving an empty panel that
                // reads as a bug: Twilio records manual calls, it doesn't
                // transcribe them.
                "Manual calls are recorded, not transcribed. Play the recording below."}
          </InlineEmpty>
        )}

        {call?.hasRecording && call.recordingUrl ? (
          <div className="rounded-xl border border-border/60 bg-surface/60 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <Play className="h-3.5 w-3.5" />
                Recording
              </p>
              <a
                href={call.recordingUrl}
                download={`recording-${slug(name)}-${fileStamp}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio
              ref={audioRef}
              controls
              preload="none"
              src={call.recordingUrl}
              className="w-full"
              // The playhead drives the transcript highlight — clicking a turn
              // seeks here, and this keeps the active turn in lockstep.
              onTimeUpdate={(e) => setActiveSecs(e.currentTarget.currentTime)}
            />
          </div>
        ) : (
          !loading && (
            <p className="text-center text-xs text-muted-foreground">
              {call?.outcome &&
              ["no_answer", "voicemail", "wrong_number"].includes(call.outcome)
                ? "No recording — the call didn't connect."
                : "No recording is available for this call."}
            </p>
          )
        )}
      </div>

      {call?.leadId ? (
        <div className="border-t border-border/60 p-4">
          {/* Straight to the canonical record — the old /leads?q= search link
              made you find the row again yourself. Closes this modal first
              (sibling portals share z, the drawer would open underneath). */}
          <LeadOpenLink
            leadId={call.leadId}
            onOpen={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground hover:no-underline"
          >
            <ExternalLink className="h-4 w-4" />
            Open this {vocab.leadNoun}&#39;s full record
          </LeadOpenLink>
        </div>
      ) : call?.leadName || call?.phone ? (
        // No lead row behind this call (deleted, or never matched) — fall back
        // to a name/number search in the book.
        <div className="border-t border-border/60 p-4">
          <Link
            href={`/leads?q=${encodeURIComponent(call.leadName || call.phone || "")}`}
            className="flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
            Search this {vocab.leadNoun} in {vocab.LeadNounPlural}
          </Link>
        </div>
      ) : null}
    </Modal>
  );
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "call"
  );
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "404") return "That call is no longer in your archive.";
  if (msg === "401" || msg === "403") return "You don't have access to that call.";
  return "Couldn't load the call. Try again in a moment.";
}
