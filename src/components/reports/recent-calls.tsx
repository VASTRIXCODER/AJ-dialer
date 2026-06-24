"use client";

import { Bot, PlayCircle, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CallDashboard } from "@/components/monitor/call-dashboard";
import { ManualCallDetail } from "@/components/reports/manual-call-detail";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { RecentCall } from "@/lib/db/metrics";
import { outcomeConfig } from "@/lib/status";
import { formatClock, formatDuration, initials } from "@/lib/utils";

/**
 * Recent-calls table where every row opens the full per-call breakdown: AI rows
 * open the AI dashboard (transcript, summary, recording, disposition); manual
 * rows open the human-call detail (summary, outcome, recording) — so both
 * channels get the same depth in Reports.
 */
export function RecentCalls({ calls }: { calls: RecentCall[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [manualCall, setManualCall] = useState<RecentCall | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3">Source</th>
              <th className="px-5 py-3">Homeowner</th>
              <th className="px-5 py-3">Time</th>
              <th className="px-5 py-3 text-right">Duration</th>
              <th className="px-5 py-3">Outcome</th>
              <th className="px-5 py-3 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {calls.map((rec) => {
              const cfg = rec.outcome ? outcomeConfig[rec.outcome] : null;
              const isAI = rec.channel === "ai";
              // Every row is openable: AI → AI dashboard, manual → manual detail.
              const openable = isAI ? Boolean(rec.conversationId) : true;
              const open = () => {
                if (isAI && rec.conversationId) setOpenId(rec.conversationId);
                else if (!isAI) setManualCall(rec);
              };
              const recordingHref = !rec.hasRecording
                ? null
                : isAI && rec.conversationId
                  ? `/api/elevenlabs/audio/${encodeURIComponent(rec.conversationId)}`
                  : rec.recordingUrl || null;
              return (
                <tr
                  key={rec.id}
                  onClick={openable ? open : undefined}
                  className={
                    "transition-colors hover:bg-muted/40" +
                    (openable ? " cursor-pointer" : "")
                  }
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={isAI ? "accent" : "neutral"} className="gap-1">
                        {isAI ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                        {isAI ? "AI" : "Manual"}
                      </Badge>
                      {rec.repName && (
                        <span className="flex items-center gap-1.5">
                          <Avatar initials={initials(rec.repName)} color="#0EA5E9" size="xs" />
                          <span className="truncate text-xs font-medium text-muted-foreground">
                            {rec.repName}
                          </span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{rec.leadName}</td>
                  <td className="px-5 py-3 text-muted-foreground tabular">
                    {formatClock(rec.startedAt)}
                  </td>
                  <td className="px-5 py-3 text-right tabular">
                    {rec.durationSec ? formatDuration(rec.durationSec) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    {cfg ? (
                      <Badge tone={cfg.tone}>{cfg.label}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
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
                      {openable && <span className="text-xs font-medium text-primary">View →</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openId && (
        <CallDashboard
          key={openId}
          conversationId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => router.refresh()}
        />
      )}

      {manualCall && (
        <ManualCallDetail call={manualCall} onClose={() => setManualCall(null)} />
      )}
    </>
  );
}
