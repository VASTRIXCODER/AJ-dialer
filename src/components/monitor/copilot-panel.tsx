"use client";

import { Lightbulb, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { AiSourceBadge } from "@/components/ai/source-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CallCopilot } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

const TONE: Record<string, "success" | "neutral" | "danger"> = {
  positive: "success",
  neutral: "neutral",
  negative: "danger",
};

/**
 * On-demand AI guidance for a supervisor watching a LIVE call — the copilot
 * service's first real consumer. Deliberately button-triggered, not polled:
 * a supervisor asks when they're deciding whether to take over, and each ask
 * sends the transcript as it stands, so the guidance describes THIS call.
 */
export function CopilotPanel({
  leadId,
  transcript,
}: {
  leadId: string;
  transcript: { role: string; message: string }[];
}) {
  const [state, setState] = useState<{
    loading: boolean;
    data?: CallCopilot;
    source?: "claude" | "demo";
    /** A failure to FETCH guidance — shown in the panel's error banner. */
    error?: string;
    /** Why the server used the simulator — shown on the source badge. */
    sourceError?: string;
  }>({ loading: false });

  async function fetchGuidance() {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const res = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId,
          transcript: transcript.map((t) => `${t.role}: ${t.message}`).join("\n"),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        data?: CallCopilot;
        source?: "claude" | "demo";
        error?: string;
      };
      if (!res.ok || !j.data) throw new Error(j.error ?? "failed");
      // j.error on a 200 is not a failure — it's why the SERVER fell back to the
      // simulator, and it belongs on the badge rather than in the error banner.
      setState({ loading: false, data: j.data, source: j.source, sourceError: j.error });
    } catch {
      setState((s) => ({
        ...s,
        loading: false,
        error: "Couldn’t get guidance right now — try again in a moment.",
      }));
    }
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-primary-soft/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
          <Sparkles className="h-4 w-4" />
          Live copilot
        </span>
        <div className="flex items-center gap-2">
          {state.source && !state.loading && (
            <AiSourceBadge source={state.source} error={state.sourceError} />
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={state.loading}
            onClick={fetchGuidance}
          >
            {state.loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {state.data ? "Refresh guidance" : "Get AI guidance"}
          </Button>
        </div>
      </div>

      {state.error && (
        <p className="mt-2 text-xs font-medium text-danger">{state.error}</p>
      )}

      {state.data && !state.loading && (
        <div className="mt-3 space-y-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="primary">{state.data.stage}</Badge>
            {state.data.signals.map((s, i) => (
              <Badge key={i} tone={TONE[s.tone] ?? "neutral"}>
                {s.label}
              </Badge>
            ))}
          </div>
          <p className="text-xs leading-relaxed">
            <span className="font-bold uppercase tracking-wide text-muted-foreground">
              Ask next:{" "}
            </span>
            {state.data.nextQuestion}
          </p>
          {state.data.objectionHandler && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-bold uppercase tracking-wide">If they push back: </span>
              {state.data.objectionHandler}
            </p>
          )}
          {state.data.coachingTip && (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              {state.data.coachingTip}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
