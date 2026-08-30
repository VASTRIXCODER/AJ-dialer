"use client";

import { ArrowDown, MessageSquare, Radio } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type RelaySegment,
  dedupeByTurnIndex,
} from "@/lib/monitor/transcript-relay";
import type { TranscriptSegmentPayload } from "@/lib/realtime/events";
import { useOrgChannel } from "@/lib/realtime/use-org-channel";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// LiveTranscriptPane — the floor's shared live transcript view.
//
// Two feeds, deduped by turnIndex so double delivery is harmless:
//   • `transcript.segment` broadcasts on the org channel (instant, may be
//     missed across reconnects)
//   • the relay poll — GET /api/monitor/transcript/[id]?since=… every 3s, only
//     while this pane is mounted AND the tab is visible. The relay itself
//     shares ONE provider poll across every supervisor (see the route).
// Honesty rules: the header says "Live · updates every few seconds" (ElevenLabs
// has no push — pretending otherwise is how "the transcript is broken" gets
// reported), and a visible "Transcript delayed" note appears when a live call
// has produced nothing new for >10s.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS = 3_000;
const DELAYED_AFTER_MS = 10_000;

export function LiveTranscriptPane({
  orgId,
  conversationId,
  live,
  contactLabel = "Contact",
  className,
}: {
  orgId: string | null;
  conversationId: string;
  /** Whether the call is still on the phone (drives the delayed note). */
  live: boolean;
  /** Whose words the right-hand bubbles are (first name or workspace noun). */
  contactLabel?: string;
  className?: string;
}) {
  const [segments, setSegments] = useState<RelaySegment[]>([]);
  const [pinned, setPinned] = useState(true); // pinned-to-latest until they scroll up
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTurnRef = useRef(-1);
  const lastSegmentAtRef = useRef<number>(Date.now()); // mount counts as activity
  const inFlightRef = useRef(false);

  const append = useCallback((incoming: RelaySegment[]) => {
    if (incoming.length === 0) return;
    setSegments((prev) => {
      const next = dedupeByTurnIndex(prev, incoming);
      if (next.length !== prev.length) lastSegmentAtRef.current = Date.now();
      lastTurnRef.current = next.length ? next[next.length - 1].turnIndex : -1;
      return next;
    });
  }, []);

  const load = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    fetch(
      `/api/monitor/transcript/${encodeURIComponent(conversationId)}?since=${lastTurnRef.current}`,
      { cache: "no-store" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { segments?: RelaySegment[] } | null) => {
        if (j?.segments) append(j.segments);
      })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [conversationId, append]);

  // Broadcast fast-path: a segment relayed by ANY supervisor's poll lands here
  // without waiting for our own tick. Keyed dedupe makes replays a no-op.
  useOrgChannel({
    orgId,
    on: {
      "transcript.segment": (p: TranscriptSegmentPayload) => {
        if (p.conversationId !== conversationId) return;
        append([
          {
            turnIndex: p.turnIndex,
            role: p.role,
            message: p.message,
            secs: p.secs,
            final: p.final,
          },
        ]);
      },
    },
    onResync: load,
  });

  // The relay poll — only while mounted + visible (useVisiblePoll pauses in
  // hidden tabs and refires immediately on return).
  useVisiblePoll(load, POLL_MS);

  // 1s tick drives the "delayed" note.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Reset per conversation.
  useEffect(() => {
    setSegments([]);
    setPinned(true);
    lastTurnRef.current = -1;
    lastSegmentAtRef.current = Date.now();
  }, [conversationId]);

  // Autoscroll while pinned; scrolling up unpins (so a supervisor reading back
  // isn't yanked to the bottom); the jump button re-pins.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [segments.length, pinned]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setPinned(atBottom);
  }

  const delayed = live && now - lastSegmentAtRef.current > DELAYED_AFTER_MS;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          Transcript
          {live && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-success/12 px-1.5 py-0.5 text-[11px] font-bold text-success">
              <Radio className="h-3 w-3" />
              Live · updates every few seconds
            </span>
          )}
        </p>
        {delayed && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warning">
            Transcript delayed
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="max-h-full space-y-2.5 overflow-y-auto pr-1"
        >
          {segments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
              {live
                ? "Waiting for the conversation to begin…"
                : "No transcript available for this call."}
            </div>
          ) : (
            segments.map((s) => {
              const agent = s.role === "agent";
              return (
                <div
                  key={s.turnIndex}
                  className={cn("flex", agent ? "justify-start" : "justify-end")}
                >
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
                        "mb-0.5 text-[11px] font-bold uppercase tracking-wide",
                        agent ? "text-muted-foreground" : "text-white/70",
                      )}
                    >
                      {agent ? "AI agent" : contactLabel}
                    </p>
                    {s.message}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {!pinned && segments.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setPinned(true);
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
            className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground shadow-lift transition-colors hover:bg-muted/60"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}
