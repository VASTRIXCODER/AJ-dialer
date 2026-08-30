"use client";

import { useVocabulary } from "@/components/layout/vocabulary";
import { Badge } from "@/components/ui/badge";
import type { LeadPanel } from "@/lib/db/lead-360";
import { resolveOutcomeConfig } from "@/lib/status";
import type { CallOutcome } from "@/lib/types";
import { formatClock, formatDay, formatDuration } from "@/lib/utils";

/**
 * Every recorded call on this lead, playable inline. URLs arrive already
 * proxied (Twilio media is private — /api/twilio/recording/<sid> streams it
 * with auth). "Open call" is a placeholder until the archive deep-link lands.
 */
export function RecordingsSection({
  recordings,
}: {
  recordings: LeadPanel["recordings"];
}) {
  const vocab = useVocabulary();
  const outcomes = resolveOutcomeConfig(vocab);

  if (!recordings.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No recordings for this record yet — connected calls appear here.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {recordings.map((rec) => {
        const cfg = rec.outcome ? outcomes[rec.outcome as CallOutcome] : null;
        return (
          <li
            key={rec.id}
            className="rounded-2xl border border-border/60 bg-card p-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold">
                  {formatDay(rec.startedAt)}
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {formatClock(rec.startedAt)}
                  </span>
                </span>
                {cfg && <Badge tone={cfg.tone}>{cfg.label}</Badge>}
                {rec.durationSec > 0 && (
                  <span className="text-xs text-muted-foreground tabular">
                    {formatDuration(rec.durationSec)}
                  </span>
                )}
              </div>
              <button
                type="button"
                title="Opens in call archive"
                aria-disabled="true"
                className="cursor-default rounded-lg px-2 py-1 text-xs font-semibold text-ink-3"
              >
                Open call
              </button>
            </div>
            <audio controls preload="none" src={rec.url} className="mt-2 w-full" />
          </li>
        );
      })}
    </ul>
  );
}
