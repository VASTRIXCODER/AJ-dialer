"use client";

import { AiSourceBadge } from "@/components/ai/source-badge";
import { Badge } from "@/components/ui/badge";
import type { LeadPanel } from "@/lib/db/lead-360";
import { formatDay } from "@/lib/utils";
import { PanelSection } from "./section-shell";

const SENTIMENT_TONE: Record<string, "success" | "warning" | "neutral"> = {
  positive: "success",
  negative: "warning",
  neutral: "neutral",
};

/**
 * The latest call's AI summary, with the honest provenance line every AI
 * surface carries: what generated it, and from which call. Absent entirely
 * when no summarized call exists — never an invented paragraph.
 */
export function AiSummarySection({
  summary,
}: {
  summary: LeadPanel["aiSummary"];
}) {
  if (!summary) return null;
  const sentiment = (summary.sentiment ?? "").toLowerCase();
  return (
    <PanelSection
      title="AI summary"
      action={<AiSourceBadge source={summary.source} />}
    >
      <p className="text-sm leading-relaxed">{summary.summary}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2.5">
        {sentiment && SENTIMENT_TONE[sentiment] && (
          <Badge tone={SENTIMENT_TONE[sentiment]}>
            {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
          </Badge>
        )}
        <p className="text-xs text-muted-foreground">
          AI-generated from the call on {formatDay(summary.at)}
        </p>
      </div>
    </PanelSection>
  );
}
