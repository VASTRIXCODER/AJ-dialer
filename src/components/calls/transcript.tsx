"use client";

import { Check, Copy, Download, MessageSquare } from "lucide-react";
import { useState } from "react";
import { cn, formatDuration } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// A stored transcript, rendered and — crucially — takeable.
//
// Transcripts were previously read-only text inside one modal: no way to copy
// one into a CRM note, hand it to a manager, or keep it after the call left the
// list. "Easier to use" is mostly this: get it out of the screen.
//
// F1 adds the time axis back. Turn offsets (secs) were captured by the provider
// and then DISCARDED at display; now a turn that knows its offset is a seek
// button into the recording, and the playhead highlights the turn being spoken.
// Turns without secs (manual calls, legacy rows) render exactly as before — no
// fake affordance over data we don't have.
// ─────────────────────────────────────────────────────────────────────────────

export interface TranscriptTurn {
  role: "agent" | "contact";
  message: string;
  /** Seconds from call start, when the provider reported it. */
  secs?: number | null;
}

/** The loose stored shape (role strings vary: "user", "customer", …). */
export interface StoredTurn {
  role: string;
  message: string;
  secs?: number | null;
}

/**
 * Split the stored flat transcript back into speaker turns.
 *
 * The stored format is one turn per line, `"Agent: …"` / `"Contact: …"` (see
 * flattenTranscript in src/lib/db/records.ts, which collapses internal newlines
 * precisely so this round-trip holds). A line that doesn't match a speaker
 * prefix is appended to the previous turn rather than dropped — a transcript
 * from an older writer must still be readable, never silently truncated.
 */
export function parseTranscript(text: string | null | undefined): TranscriptTurn[] {
  if (!text) return [];
  const turns: TranscriptTurn[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(Agent|Contact|User|Customer)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      turns.push({
        role: m[1].toLowerCase() === "agent" ? "agent" : "contact",
        message: m[2],
      });
    } else if (turns.length) {
      turns[turns.length - 1].message += ` ${line}`;
    } else {
      turns.push({ role: "contact", message: line });
    }
  }
  return turns.filter((t) => t.message.trim());
}

/** Normalize stored turns ("user"/"customer"/… → contact) for display. */
function normalizeTurns(turns: StoredTurn[]): TranscriptTurn[] {
  return turns
    .filter((t) => (t.message ?? "").trim())
    .map((t) => ({
      role: t.role === "agent" ? "agent" : "contact",
      message: t.message,
      secs:
        typeof t.secs === "number" && Number.isFinite(t.secs) && t.secs >= 0
          ? t.secs
          : null,
    }));
}

/**
 * Which turn the playhead is inside: the LAST turn whose offset has passed.
 * Exported for tests-by-reading; pure.
 */
export function activeTurnIndex(
  turns: TranscriptTurn[],
  activeSecs: number | null | undefined,
): number {
  if (activeSecs == null) return -1;
  let active = -1;
  for (let i = 0; i < turns.length; i++) {
    const s = turns[i].secs;
    if (s != null && s <= activeSecs) active = i;
  }
  return active;
}

/** Highlight every occurrence of `term` inside `text`. */
function highlight(text: string, term: string) {
  const needle = term.trim();
  if (!needle) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const at = lower.indexOf(target, i);
    if (at === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark key={`h${n++}`} className="rounded bg-warning/30 px-0.5 text-foreground">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    i = at + needle.length;
  }
  return parts;
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can beat the download in
  // some browsers and produce a zero-byte file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TranscriptPanel({
  text,
  turns: storedTurns,
  onSeek,
  activeSecs,
  /** Whose words the non-agent bubbles are — the workspace's noun or a name. */
  contactLabel = "Contact",
  /** Search term to highlight, when the reader arrived here from a search. */
  highlightTerm = "",
  /** Base name for the downloaded .txt. */
  filename = "transcript",
  className,
}: {
  text: string | null | undefined;
  /**
   * Structured turns WITH timestamps, when the archive stored them. Preferred
   * over parsing `text`; a turn with secs becomes a seek control when `onSeek`
   * is provided.
   */
  turns?: StoredTurn[] | null;
  /** Jump the recording to this offset (wired to the modal's <audio>). */
  onSeek?: (secs: number) => void;
  /** The recording's playhead, for highlighting the turn being spoken. */
  activeSecs?: number | null;
  contactLabel?: string;
  highlightTerm?: string;
  filename?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const parsed =
    storedTurns && storedTurns.length > 0
      ? normalizeTurns(storedTurns)
      : parseTranscript(text);
  // The takeable flat text: the stored copy when we have it, else rebuilt from
  // the structured turns so copy/download never silently produce nothing.
  const flatText =
    text ||
    parsed
      .map((t) => `${t.role === "agent" ? "Agent" : "Contact"}: ${t.message}`)
      .join("\n");
  const activeIdx = activeTurnIndex(parsed, activeSecs);

  async function copy() {
    if (!flatText) return;
    try {
      await navigator.clipboard.writeText(flatText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated and blocked outright in some embeds.
      // Falling back to a download beats a button that silently does nothing.
      download(`${filename}.txt`, flatText);
    }
  }

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          Transcript
          {parsed.length > 0 && (
            <span className="font-medium normal-case tracking-normal text-ink-3">
              · {parsed.length} turn{parsed.length === 1 ? "" : "s"}
            </span>
          )}
        </p>
        {flatText && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => download(`${filename}.txt`, flatText)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              .txt
            </button>
          </div>
        )}
      </div>

      {parsed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
          No transcript for this call.
        </div>
      ) : (
        <div className="space-y-2.5">
          {parsed.map((t, i) => {
            const agent = t.role === "agent";
            const seekable = t.secs != null && Boolean(onSeek);
            const active = i === activeIdx;
            const bubble = (
              <div
                className={cn(
                  "max-w-[82%] rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed transition-shadow",
                  agent
                    ? "rounded-bl-md bg-muted text-foreground"
                    : "rounded-br-md bg-brand text-white",
                  active && "ring-2 ring-accent/70",
                  seekable && "cursor-pointer hover:shadow-soft",
                )}
              >
                <p
                  className={cn(
                    "mb-0.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide",
                    agent ? "text-muted-foreground" : "text-white/70",
                  )}
                >
                  {agent ? "Agent" : contactLabel}
                  {t.secs != null && (
                    <span className="font-medium normal-case tabular opacity-80">
                      {formatDuration(Math.floor(t.secs))}
                    </span>
                  )}
                </p>
                {highlight(t.message, highlightTerm)}
              </div>
            );
            return (
              <div key={i} className={cn("flex", agent ? "justify-start" : "justify-end")}>
                {seekable ? (
                  // A turn that knows WHEN it was said is a seek control into
                  // the recording; one without secs stays a plain bubble — the
                  // honest fallback for legacy transcripts.
                  <button
                    type="button"
                    onClick={() => onSeek!(t.secs!)}
                    title={`Play from ${formatDuration(Math.floor(t.secs!))}`}
                    className={cn(
                      "flex max-w-full bg-transparent p-0 text-left",
                      agent ? "justify-start" : "justify-end",
                    )}
                  >
                    {bubble}
                  </button>
                ) : (
                  bubble
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
