"use client";

import { Bot, PlayCircle, User } from "lucide-react";
import { useState } from "react";
import { CallDetailModal } from "@/components/calls/call-detail-modal";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { RecentCall } from "@/lib/db/metrics";
import { resolveOutcomeConfig } from "@/lib/status";
import { formatClock, formatDuration, initials, leadDisplayName, cn } from "@/lib/utils";
import { CELL } from "@/lib/ui-density";

/**
 * Recent-calls table. Every row opens the SAME detail view regardless of
 * channel — there used to be two (an AI dashboard with a transcript and a manual
 * detail without one), so what you could see about a call depended on who placed
 * it. One view means one answer to "where's the transcript?".
 */
export function RecentCalls({ calls }: { calls: RecentCall[] }) {
  const vocab = useVocabulary();
  const outcomes = resolveOutcomeConfig(vocab);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className={cn(CELL)}>Source</th>
              <th className={cn(CELL)}>{vocab.LeadNoun}</th>
              <th className={cn(CELL)}>Time</th>
              <th className={cn(CELL, "text-right")}>Duration</th>
              <th className={cn(CELL)}>Outcome</th>
              <th className={cn(CELL, "text-right")}>Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {calls.map((rec) => {
              const cfg = rec.outcome ? outcomes[rec.outcome] : null;
              const isAI = rec.channel === "ai";
              const open = () => setOpenId(rec.id);
              const recordingHref = !rec.hasRecording
                ? null
                : isAI && rec.conversationId
                  ? `/api/elevenlabs/audio/${encodeURIComponent(rec.conversationId)}`
                  : rec.recordingUrl || null;
              return (
                <tr
                  key={rec.id}
                  onClick={open}
                  // aria-hidden would be wrong (the cells carry the content);
                  // the row is simply not focusable, and the View button in the
                  // last cell is the keyboard route.
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                >
                  <td className={cn(CELL)}>
                    <div className="flex items-center gap-2">
                      <Badge tone={isAI ? "accent" : "neutral"} className="gap-1">
                        {isAI ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                        {isAI ? "AI" : "Manual"}
                      </Badge>
                      {rec.repName && (
                        <span className="flex items-center gap-1.5">
                          <Avatar initials={initials(rec.repName)} seed={rec.repName} size="xs" />
                          <span className="truncate text-xs font-medium text-muted-foreground">
                            {rec.repName}
                          </span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cn(CELL, "text-muted-foreground")}>
                    {leadDisplayName(rec.leadName, rec.phone, vocab.leadNoun)}
                  </td>
                  <td className={cn(CELL, "text-muted-foreground tabular")}>
                    {formatClock(rec.startedAt)}
                  </td>
                  <td className={cn(CELL, "text-right tabular")}>
                    {rec.durationSec ? formatDuration(rec.durationSec) : "—"}
                  </td>
                  <td className={cn(CELL)}>
                    {cfg ? (
                      <Badge tone={cfg.tone} icon={cfg.icon}>{cfg.label}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={cn(CELL, "text-right")}>
                    <div className="flex items-center justify-end gap-3">
                      {recordingHref && (
                        <a
                          href={recordingHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          <PlayCircle className="h-4 w-4" />
                          Play
                        </a>
                      )}
                      {/* A real button. The row's onClick is a mouse
                          convenience; this was the only route to the call
                          detail modal and it was a <span>, so the table had no
                          keyboard path at all. onClick stops propagating so
                          the row handler does not also fire. */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open();
                        }}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        View →
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openId && (
        <CallDetailModal key={openId} callId={openId} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}
