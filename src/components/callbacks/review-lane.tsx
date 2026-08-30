"use client";

import {
  Bot,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Phone,
  ShieldAlert,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CallDetailModal } from "@/components/calls/call-detail-modal";
import { useVocabulary } from "@/components/layout/vocabulary";
import { LeadOpenLink } from "@/components/leads/lead-360/lead-open-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { resolveDispositionDefs, type DispositionDef } from "@/lib/dispositions/defs";
import type { ReviewQueueRow } from "@/lib/db/review-queue";
import { canActOnReview, type ReviewAction } from "@/lib/reviews/actions";
import { formatPhone, relativeTime } from "@/lib/utils";
import { Z } from "@/lib/z-layers";

// ─────────────────────────────────────────────────────────────────────────────
// The "Needs review" lane (F1) — first section of the callbacks workspace.
//
// Rows are calls the AI analyzer refused to auto-disposition (low confidence,
// a high-impact outcome like do_not_call, or no transcript to verify against)
// plus rep-flagged wrap-ups. Each shows the proposal + its confidence and the
// reason it stopped here; a person accepts it, changes it (org taxonomy
// picker), or dismisses the review. Buttons follow the SAME pure rules the
// server enforces (src/lib/reviews/actions.ts) — a rep sees actions only on
// their own calls.
// ─────────────────────────────────────────────────────────────────────────────

const REASON_META: Record<string, { label: string; tone: "warning" | "danger" | "neutral" | "accent" }> = {
  low_confidence: { label: "Low confidence", tone: "warning" },
  high_impact: { label: "High impact", tone: "danger" },
  conflict: { label: "Conflict", tone: "danger" },
  missing_transcript: { label: "No transcript", tone: "neutral" },
  rep_flagged: { label: "Rep flagged", tone: "accent" },
};

export function ReviewLane({
  rows: initialRows,
  /** The org's raw settings.dispositions blob — resolved client-side. */
  dispositions,
  userId,
  supervisor,
  /** The server page's clock, so ages agree at hydration. */
  initialNow,
}: {
  rows: ReviewQueueRow[];
  dispositions: unknown;
  userId: string;
  supervisor: boolean;
  initialNow: number;
}) {
  const vocab = useVocabulary();
  const { toast } = useToast();
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickerId, setPickerId] = useState<string | null>(null);
  const [openCallId, setOpenCallId] = useState<string | null>(null);

  const defs = useMemo(
    () => resolveDispositionDefs(dispositions).filter((d) => d.enabled),
    [dispositions],
  );
  const labelFor = (key: string | null): string => {
    if (!key) return "—";
    const def = defs.find((d) => d.key === key);
    return def ? def.label : key.replace(/^x_/, "").replace(/_/g, " ");
  };

  const act = async (row: ReviewQueueRow, action: ReviewAction, key?: string) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/review-queue/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(key ? { dispositionKey: key } : {}) }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        toast({ title: j.error || "Couldn't update the review.", tone: "danger" });
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast({
        title:
          action === "accept"
            ? `Filed as ${labelFor(key ?? row.proposedDisposition)}`
            : action === "change"
              ? `Changed to ${labelFor(key ?? null)}`
              : "Review dismissed",
        tone: action === "dismiss" ? "default" : "success",
      });
    } catch {
      toast({ title: "Couldn't update the review.", tone: "danger" });
    } finally {
      setBusyId(null);
      setPickerId(null);
    }
  };

  if (rows.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-warning/5 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-warning" />
          Needs review
          <Badge tone="warning" className="tabular">
            {rows.length}
          </Badge>
        </p>
        <p className="hidden text-xs text-muted-foreground sm:block">
          Calls the AI wouldn&#39;t disposition on its own — a person decides.
        </p>
      </div>
      <ul className="divide-y divide-border/50">
        {rows.map((row) => {
          const reason = REASON_META[row.reason] ?? {
            label: row.reason.replace(/_/g, " "),
            tone: "neutral" as const,
          };
          const mayAct = canActOnReview({
            supervisor,
            userId,
            recordOwnerId: row.ownerId,
          });
          const busy = busyId === row.id;
          const confidencePct =
            row.confidence != null ? `${Math.round(row.confidence * 100)}%` : null;
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  {row.channel === "ai" ? (
                    <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {row.leadId ? (
                    <LeadOpenLink
                      leadId={row.leadId}
                      className="truncate text-sm font-semibold"
                    >
                      {row.leadName || formatPhone(row.phone) || `Unknown ${vocab.leadNoun}`}
                    </LeadOpenLink>
                  ) : (
                    <span className="truncate text-sm font-semibold">
                      {row.leadName || formatPhone(row.phone) || "Unknown call"}
                    </span>
                  )}
                  <Badge tone={reason.tone}>{reason.label}</Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {row.proposedDisposition ? (
                    <>
                      Proposed:{" "}
                      <span className="font-semibold text-foreground">
                        {labelFor(row.proposedDisposition)}
                      </span>
                      {confidencePct ? ` · ${confidencePct} confident` : ""}
                    </>
                  ) : (
                    "No proposed disposition"
                  )}
                  {row.createdAt
                    ? ` · ${relativeTime(row.createdAt, new Date(initialNow))}`
                    : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {row.callRecordId && (
                  <button
                    type="button"
                    onClick={() => setOpenCallId(row.callRecordId)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View call
                  </button>
                )}
                {mayAct && (
                  <>
                    <button
                      type="button"
                      disabled={busy || !row.proposedDisposition}
                      title={
                        row.proposedDisposition
                          ? `File as ${labelFor(row.proposedDisposition)}`
                          : "No proposed disposition to accept"
                      }
                      onClick={() => act(row, "accept")}
                      className="inline-flex items-center gap-1 rounded-lg bg-success/10 px-2 py-1 text-xs font-semibold text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      Accept
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPickerId(pickerId === row.id ? null : row.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                      >
                        Change
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      {pickerId === row.id && (
                        <DispositionPicker
                          defs={defs}
                          onPick={(key) => act(row, "change", key)}
                          onClose={() => setPickerId(null)}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      title="Close this review without changing the call"
                      onClick={() => act(row, "dismiss")}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                      Dismiss
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {openCallId && (
        <CallDetailModal callId={openCallId} onClose={() => setOpenCallId(null)} />
      )}
    </Card>
  );
}

/** The org's taxonomy as a small pick list — same defs the wrap-up shows. */
function DispositionPicker({
  defs,
  onPick,
  onClose,
}: {
  defs: DispositionDef[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Click-away scrim */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 cursor-default" style={{ zIndex: Z.rowMenu }}
      />
      <div style={{ zIndex: Z.rowMenu + 1 }} className="absolute right-0 mt-1 max-h-64 w-48 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lift">
        {defs.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => onPick(d.key)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/70"
          >
            <span
              className={
                d.tone === "success"
                  ? "h-1.5 w-1.5 rounded-full bg-success"
                  : d.tone === "warning"
                    ? "h-1.5 w-1.5 rounded-full bg-warning"
                    : d.tone === "danger"
                      ? "h-1.5 w-1.5 rounded-full bg-danger"
                      : "h-1.5 w-1.5 rounded-full bg-muted-foreground"
              }
            />
            {d.label}
          </button>
        ))}
      </div>
    </>
  );
}
