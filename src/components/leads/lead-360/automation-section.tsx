"use client";

import { ClipboardList, Flame, Loader2, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Timeline, type TimelineDisplayItem } from "@/components/ui/timeline";
import {
  executionCopy,
  instanceStatusCopy,
  opportunityEventCopy,
  workReasonLabel,
  workTypeLabel,
} from "@/lib/opportunities/event-copy";
import { relativeTime } from "@/lib/utils";
import { PanelSection } from "./section-shell";

// ─────────────────────────────────────────────────────────────────────────────
// What the automation did to this record, and why.
//
// The first reader of four append-only logs that have been filling up with no
// surface at all. Until this existed, "why was I escalated about this person?"
// and "why did the playbook stop?" had no answer anywhere in the product.
//
// TabPanel renders its children whether or not the tab is selected — that is a
// documented contract the notes draft-preservation depends on, so it is not
// changed. Instead this body takes `active` and fetches only once its tab is
// actually opened. Without that, every Lead 360 open anywhere (including the
// drawer over a live call) would fire five queries nobody asked for.
// ─────────────────────────────────────────────────────────────────────────────

interface AutomationEvent {
  id: string;
  type: string;
  actorKind: string;
  actorName: string | null;
  fromStage: string | null;
  toStage: string | null;
  detail: Record<string, unknown>;
  at: string;
}
interface AutomationStep {
  id: string;
  stepIndex: number;
  actionKind: string;
  status: string;
  detail: Record<string, unknown>;
  error: string | null;
  at: string;
}
interface AutomationRun {
  id: string;
  name: string;
  version: number;
  status: string;
  currentStep: number;
  stoppedReason: string | null;
  startedAt: string;
  endedAt: string | null;
  steps: AutomationStep[];
}
interface AutomationWorkItem {
  id: string;
  type: string;
  reason: string;
  status: string;
  priority: number;
  queue: string | null;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
}
interface AutomationSignal {
  id: string;
  type: string;
  severity: number;
  reason: string;
  audience: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  acknowledged: boolean;
}
interface AutomationPayload {
  events: AutomationEvent[];
  runs: AutomationRun[];
  workItems: AutomationWorkItem[];
  signals: AutomationSignal[];
}

export function AutomationSection({
  leadId,
  active,
}: {
  leadId: string;
  /** True while this tab is the selected one. Nothing loads before that. */
  active: boolean;
}) {
  const [data, setData] = useState<AutomationPayload | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  // Bumped by Try again. It has to be in the effect's dependencies or the
  // retry is a button that re-renders and does nothing — `active` and `leadId`
  // are both unchanged at the moment the rep presses it.
  const [attempt, setAttempt] = useState(0);
  // History changes on the order of hours; re-fetching every time the rep
  // flicks back to this tab would be noise. One load per lead, per open.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!active || loadedFor.current === leadId) return;
    loadedFor.current = leadId;
    setState("loading");
    setData(null);
    const ac = new AbortController();
    fetch(`/api/leads/${encodeURIComponent(leadId)}/automation`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: AutomationPayload) => {
        setData(j);
        setState("idle");
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === "AbortError") {
          // Release the "already loaded this lead" claim. Leaving it set after
          // an abort wedged the tab permanently: `state` was still "loading"
          // and the guard blocked every future attempt, so switching away
          // mid-fetch — which arrow-key tab navigation does on the way past,
          // since selection follows focus — left a spinner with no recovery
          // short of reopening the record.
          loadedFor.current = null;
          setState("idle");
          return;
        }
        // Let the rep retry rather than leaving a permanently blank tab.
        loadedFor.current = null;
        setState("error");
      });
    return () => ac.abort();
  }, [active, leadId, attempt]);

  if (state === "loading") {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the record's history…
      </p>
    );
  }

  if (state === "error") {
    return (
      <div className="py-6">
        <p className="text-sm text-muted-foreground">
          The automation history couldn't be read.
        </p>
        <button
          type="button"
          onClick={() => {
            loadedFor.current = null;
            setData(null);
            setState("idle");
            setAttempt((a) => a + 1);
          }}
          className="mt-1 text-xs font-semibold text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const nothing =
    data.events.length === 0 &&
    data.runs.length === 0 &&
    data.workItems.length === 0 &&
    data.signals.length === 0;

  if (nothing) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        No automation has run against this record yet. Published playbooks act on
        records as they go unworked — silence here means nothing has needed to.
      </p>
    );
  }

  const historyItems: TimelineDisplayItem[] = data.events.map((e) => {
    const copy = opportunityEventCopy(e);
    return { id: e.id, at: e.at, title: copy.title, detail: copy.detail, tone: copy.tone };
  });

  return (
    <div className="space-y-4">
      {data.signals.length > 0 && (
        <PanelSection title="Alerts raised">
          <ul className="space-y-2">
            {data.signals.map((sig) => (
              <li key={sig.id} className="flex items-start gap-2 text-sm">
                <Flame
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                    sig.resolvedAt
                      ? "text-muted-foreground"
                      : sig.severity >= 4
                        ? "text-danger"
                        : "text-warning"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {sig.reason || workReasonLabel(sig.type)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {relativeTime(sig.detectedAt)}
                    {" · "}
                    {sig.audience === "owner" ? "sent to the owner" : "sent to managers"}
                    {sig.resolvedAt
                      ? ` · resolved ${relativeTime(sig.resolvedAt)}`
                      : sig.acknowledged
                        ? " · acknowledged"
                        : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {data.runs.length > 0 && (
        <PanelSection title="Playbook runs">
          <ul className="space-y-3">
            {data.runs.map((run) => {
              const status = instanceStatusCopy(run);
              return (
                <li key={run.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Workflow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-semibold">{run.name}</span>
                    <span className="text-xs text-muted-foreground">v{run.version}</span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <p className="mt-0.5 pl-5 text-xs text-muted-foreground">
                    {status.detail} Started {relativeTime(run.startedAt)}
                    {run.endedAt ? `, ended ${relativeTime(run.endedAt)}` : ""}.
                  </p>
                  {run.steps.length > 0 && (
                    <ul className="mt-1.5 space-y-1 pl-5">
                      {run.steps.map((step) => {
                        const copy = executionCopy(step);
                        return (
                          <li key={step.id} className="text-xs">
                            <span
                              className={
                                copy.tone === "warning"
                                  ? "text-warning"
                                  : copy.tone === "danger"
                                    ? "text-danger"
                                    : "text-muted-foreground"
                              }
                            >
                              {copy.title}
                            </span>
                            {copy.detail && (
                              <span className="text-muted-foreground"> — {copy.detail}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </PanelSection>
      )}

      {data.workItems.length > 0 && (
        <PanelSection title="Tasks">
          <ul className="space-y-2">
            {data.workItems.map((w) => (
              <li key={w.id} className="flex items-start gap-2 text-sm">
                <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {workTypeLabel(w.type)}
                    {w.reason && (
                      <span className="text-muted-foreground"> — {workReasonLabel(w.reason)}</span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {w.completedAt
                      ? `Completed ${relativeTime(w.completedAt)}`
                      : w.dueAt
                        ? `Due ${relativeTime(w.dueAt)}`
                        : `Created ${relativeTime(w.createdAt)}`}
                    {" · "}
                    {workReasonLabel(w.status)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {historyItems.length > 0 && (
        <PanelSection title="Stage history">
          <Timeline items={historyItems} />
          {data.events.length >= 40 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the 40 most recent changes.
            </p>
          )}
        </PanelSection>
      )}
    </div>
  );
}
