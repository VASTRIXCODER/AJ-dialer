"use client";

import {
  Bot,
  CalendarCheck,
  ClipboardList,
  Download,
  ExternalLink,
  Loader2,
  NotebookPen,
  Phone,
  Play,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import type { ArchiveCall } from "@/lib/db/call-archive";
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

type FullCall = ArchiveCall & { transcriptText: string | null };

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
    preview ? { ...preview, transcriptText: null } : null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <ClipboardList className="h-3.5 w-3.5" />
              Call summary
            </p>
            <p className="text-sm leading-relaxed">{call.summary}</p>
          </div>
        ) : (
          !loading && (
            <div className="rounded-xl border border-dashed border-border/70 px-4 py-5 text-center text-sm text-muted-foreground">
              No summary was generated for this call.
            </div>
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

        {loading && !call?.transcriptText ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the transcript…
          </div>
        ) : call?.transcriptText ? (
          <TranscriptPanel
            text={call.transcriptText}
            contactLabel={firstName}
            highlightTerm={highlightTerm}
            filename={`transcript-${slug(name)}-${fileStamp}`}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-5 text-center text-sm text-muted-foreground">
            {isAI
              ? "No transcript — this call didn't reach a conversation."
              : // Say the true reason rather than leaving an empty panel that
                // reads as a bug: Twilio records manual calls, it doesn't
                // transcribe them.
                "Manual calls are recorded, not transcribed. Play the recording below."}
          </div>
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
            <audio controls preload="none" src={call.recordingUrl} className="w-full" />
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

      {call?.leadId && (
        <div className="border-t border-border/60 p-4">
          <Link
            href={`/leads?q=${encodeURIComponent(call.leadName || call.phone || "")}`}
            className="flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
            Open this {vocab.leadNoun} in {vocab.LeadNounPlural}
          </Link>
        </div>
      )}
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
