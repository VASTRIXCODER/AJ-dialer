"use client";

import { PhoneOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LeadPanel } from "@/lib/db/lead-360";
import type { TimelineItem } from "@/lib/db/lead-timeline";
import { formatDay, relativeTime } from "@/lib/utils";
import { PanelSection } from "./section-shell";

const SOURCE_LABELS: Record<string, string> = {
  manual: "added manually",
  import: "DNC list import",
  ai_disposition: "AI call disposition",
  rep_disposition: "rep disposition",
  sms_stop: "SMS STOP reply",
};

/**
 * Only rendered when the number is suppressed or has suppression history —
 * a clean lead shows no DNC section at all. The current state comes from the
 * live dnc_numbers row; the history is the timeline's dnc audit entries.
 */
export function DncSection({
  panel,
  history,
}: {
  panel: LeadPanel;
  /** Timeline items of kind "dnc", newest first. */
  history: TimelineItem[];
}) {
  const dnc = panel.dnc;
  if (!dnc && history.length === 0) return null;

  return (
    <PanelSection title="Do Not Call">
      {dnc ? (
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/12 text-danger">
            <PhoneOff className="h-4 w-4" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-danger">This number is suppressed</p>
            <p className="mt-0.5 text-muted-foreground">
              {[
                dnc.reason || "No reason recorded",
                dnc.source ? `via ${SOURCE_LABELS[dnc.source] ?? dnc.source.replace(/_/g, " ")}` : null,
                dnc.addedAt ? formatDay(dnc.addedAt) : null,
                dnc.addedByName ? `by ${dnc.addedByName}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <Badge tone="success">Not currently suppressed</Badge>
          <span className="text-muted-foreground">but this number has DNC history:</span>
        </div>
      )}

      {history.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-border/40 pt-3">
          {history.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{item.title}</span>
                {item.detail && (
                  <span className="text-muted-foreground"> — {item.detail}</span>
                )}
                {item.actor && <span className="text-muted-foreground"> · {item.actor}</span>}
              </span>
              <time dateTime={item.at} className="shrink-0 text-muted-foreground">
                {relativeTime(item.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}
