"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MapPin,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ParsedLead } from "@/lib/leads/csv";
import { applyLabelOverride } from "@/lib/leads/group-labels";
import type { LeadGroup } from "@/lib/types";
import { formatPhone } from "@/lib/utils";

type PreviewLead = ParsedLead & { tempId: string };
type BucketKey = LeadGroup | "unsorted";
const BUCKET_KEYS: BucketKey[] = ["fresno", "houston", "dallas", "california", "manual", "unsorted"];

const SECTION_META: Record<BucketKey, { label: string; tone: "primary" | "neutral" | "warning" }> = {
  fresno: { label: "Fresno", tone: "primary" },
  houston: { label: "Houston", tone: "primary" },
  dallas: { label: "Dallas", tone: "primary" },
  california: { label: "California", tone: "primary" },
  manual: { label: "Manual Dialing", tone: "neutral" },
  unsorted: { label: "Unsorted — needs review", tone: "warning" },
};

export interface GeoPreviewResponse {
  source: "claude" | "demo";
  chunkFailures: number;
  totalRows: number;
  groups: Record<"fresno" | "houston" | "dallas" | "california" | "unsorted", PreviewLead[]>;
  columnSource: "headers" | "ai";
  aiError: string | null;
}

type BucketState = "idle" | "pending" | "done" | "error";

/**
 * Preview-and-confirm screen for the "dump & auto-sort" upload. Nothing was
 * inserted by the preview call — every lead here is still just in memory. The
 * reviewer can move any lead (including into Manual Dialing, which the AI
 * itself never proposed — see SECTION_META /geo-classify.ts) before confirming.
 */
export function GeoPreviewReview({
  preview,
  onDone,
  onCancel,
  labelOverrides,
}: {
  preview: GeoPreviewResponse;
  onDone: () => void;
  onCancel: () => void;
  /** Per-org display-label overrides for the dropbox groups (display only). */
  labelOverrides?: Record<string, string>;
}) {
  const router = useRouter();

  const byTempId = useMemo(() => {
    const m = new Map<string, PreviewLead>();
    for (const key of Object.keys(preview.groups) as (keyof typeof preview.groups)[]) {
      for (const l of preview.groups[key]) m.set(l.tempId, l);
    }
    return m;
  }, [preview]);

  const [assignment, setAssignment] = useState<Record<string, BucketKey>>(() => {
    const init: Record<string, BucketKey> = {};
    for (const key of Object.keys(preview.groups) as (keyof typeof preview.groups)[]) {
      for (const l of preview.groups[key]) init[l.tempId] = key;
    }
    return init;
  });
  const [bucketState, setBucketState] = useState<Record<string, BucketState>>({});
  const [bucketMsg, setBucketMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const buckets = useMemo(() => {
    const out: Record<BucketKey, PreviewLead[]> = {
      fresno: [], houston: [], dallas: [], california: [], manual: [], unsorted: [],
    };
    for (const [tempId, key] of Object.entries(assignment)) {
      const lead = byTempId.get(tempId);
      if (lead) out[key].push(lead);
    }
    return out;
  }, [assignment, byTempId]);

  function moveLead(tempId: string, key: BucketKey) {
    setAssignment((prev) => ({ ...prev, [tempId]: key }));
  }

  async function importBucket(key: BucketKey, list: PreviewLead[]): Promise<boolean> {
    setBucketState((s) => ({ ...s, [key]: "pending" }));
    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: list.map(({ tempId: _tempId, ...rest }) => rest),
          leadGroup: key === "unsorted" ? null : key,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        setBucketState((s) => ({ ...s, [key]: "error" }));
        setBucketMsg((s) => ({ ...s, [key]: json.error ?? "Import failed." }));
        return false;
      }
      setBucketState((s) => ({ ...s, [key]: "done" }));
      setBucketMsg((s) => ({ ...s, [key]: `Imported ${json.inserted} leads.` }));
      return true;
    } catch {
      setBucketState((s) => ({ ...s, [key]: "error" }));
      setBucketMsg((s) => ({ ...s, [key]: "Network error." }));
      return false;
    }
  }

  // Only imports buckets NOT already "done" — so clicking Confirm again after a
  // partial failure (some buckets ok, some errored) never double-inserts the
  // ones that already succeeded; it only retries the failed/untried ones.
  async function confirm() {
    setBusy(true);
    const pending = BUCKET_KEYS.filter(
      (k) => buckets[k].length > 0 && bucketState[k] !== "done",
    );
    const results = await Promise.all(pending.map((k) => importBucket(k, buckets[k])));
    setBusy(false);
    if (results.every(Boolean)) {
      router.refresh();
      onDone();
    }
  }

  const anyErrors = BUCKET_KEYS.some((k) => bucketState[k] === "error");
  const allDone = BUCKET_KEYS.every((k) => buckets[k].length === 0 || bucketState[k] === "done");
  const totalPending = BUCKET_KEYS.reduce((n, k) => n + buckets[k].length, 0);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold tracking-tight">
            <Sparkles className="h-4 w-4 text-accent" />
            Review AI-sorted leads
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {preview.totalRows} leads classified — move any lead before confirming.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={preview.source === "claude" ? "accent" : "neutral"}>
            {preview.source === "claude" ? "Claude" : "Demo AI"}
          </Badge>
          {preview.chunkFailures > 0 && (
            <Badge tone="warning" title="Some batches fell back to rule-based matching">
              {preview.chunkFailures} batch{preview.chunkFailures === 1 ? "" : "es"} used fallback
            </Badge>
          )}
          {!busy && !allDone && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {preview.aiError && (
        <p className="mt-4 flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {preview.aiError}
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BUCKET_KEYS.map((key) => {
          const list = buckets[key];
          const meta = SECTION_META[key];
          const state = bucketState[key];
          return (
            <div key={key} className="rounded-xl border border-border/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {key === "unsorted" ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  ) : key === "manual" ? (
                    <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                  )}
                  {applyLabelOverride(key, meta.label, labelOverrides)}
                </span>
                <Badge tone={meta.tone}>{list.length}</Badge>
              </div>
              {state === "done" && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  {bucketMsg[key]}
                </p>
              )}
              {state === "error" && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-danger">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {bucketMsg[key]}
                </p>
              )}
              {state !== "done" && list.length > 0 && (
                <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                  {list.slice(0, 25).map((l) => (
                    <li
                      key={l.tempId}
                      className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {[l.firstName, l.lastName].filter(Boolean).join(" ") || formatPhone(l.phone)}
                        </p>
                        <p className="truncate text-muted-foreground">
                          {[l.city, l.state, l.zip].filter(Boolean).join(", ") || "No location"}
                        </p>
                      </div>
                      <select
                        value={key}
                        onChange={(e) => moveLead(l.tempId, e.target.value as BucketKey)}
                        disabled={busy}
                        className="h-7 shrink-0 rounded-md border border-border bg-background px-1.5 text-[11px]"
                      >
                        {BUCKET_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {applyLabelOverride(k, SECTION_META[k].label, labelOverrides)}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                  {list.length > 25 && (
                    <li className="px-2 py-1 text-center text-[11px] text-muted-foreground">
                      +{list.length - 25} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        {anyErrors && (
          <p className="text-xs text-danger">
            Some groups failed to import. Succeeded groups won&apos;t be re-inserted — click below to
            retry only what failed.
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!allDone && (
            <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1.5"
            onClick={confirm}
            disabled={busy || allDone || totalPending === 0}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {allDone ? "Imported" : anyErrors ? "Retry failed groups" : "Confirm import"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
