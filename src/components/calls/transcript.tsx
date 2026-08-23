"use client";

import { Check, Copy, Download, MessageSquare } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// A stored transcript, rendered and — crucially — takeable.
//
// Transcripts were previously read-only text inside one modal: no way to copy
// one into a CRM note, hand it to a manager, or keep it after the call left the
// list. "Easier to use" is mostly this: get it out of the screen.
// ─────────────────────────────────────────────────────────────────────────────

export interface TranscriptTurn {
  role: "agent" | "contact";
  message: string;
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
  /** Whose words the non-agent bubbles are — the workspace's noun or a name. */
  contactLabel = "Contact",
  /** Search term to highlight, when the reader arrived here from a search. */
  highlightTerm = "",
  /** Base name for the downloaded .txt. */
  filename = "transcript",
  className,
}: {
  text: string | null | undefined;
  contactLabel?: string;
  highlightTerm?: string;
  filename?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const turns = parseTranscript(text);

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated and blocked outright in some embeds.
      // Falling back to a download beats a button that silently does nothing.
      download(`${filename}.txt`, text);
    }
  }

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          Transcript
          {turns.length > 0 && (
            <span className="font-medium normal-case tracking-normal text-muted-foreground/70">
              · {turns.length} turn{turns.length === 1 ? "" : "s"}
            </span>
          )}
        </p>
        {text && (
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
              onClick={() => download(`${filename}.txt`, text)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              .txt
            </button>
          </div>
        )}
      </div>

      {turns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
          No transcript for this call.
        </div>
      ) : (
        <div className="space-y-2.5">
          {turns.map((t, i) => {
            const agent = t.role === "agent";
            return (
              <div key={i} className={cn("flex", agent ? "justify-start" : "justify-end")}>
                <div
                  className={cn(
                    "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                    agent
                      ? "rounded-bl-md bg-muted text-foreground"
                      : "rounded-br-md bg-brand text-white",
                  )}
                >
                  <p
                    className={cn(
                      "mb-0.5 text-[10px] font-bold uppercase tracking-wide",
                      agent ? "text-muted-foreground" : "text-white/70",
                    )}
                  >
                    {agent ? "Agent" : contactLabel}
                  </p>
                  {highlight(t.message, highlightTerm)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
