"use client";

import { History, Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useVocabulary } from "@/components/layout/vocabulary";
import { formatNumber, relativeTime, cn } from "@/lib/utils";
import { CELL } from "@/lib/ui-density";

// ─────────────────────────────────────────────────────────────────────────────
// Recent import jobs — what happened lately, at a glance, with rollback where
// it still applies. This list is the difference between "an import happened at
// some point" and an auditable record of who imported what and how it went.
// ─────────────────────────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  fileName: string;
  status: string;
  rowsTotal: number;
  created: number;
  updated: number;
  duplicates: number;
  dnc: number;
  invalid: number;
  skipped: number;
  failed: number;
  createdAt: string;
}

const STATUS_TONE: Record<string, "accent" | "success" | "neutral" | "danger" | "warning"> = {
  running: "accent",
  completed: "success",
  canceled: "neutral",
  failed: "danger",
  rolled_back: "warning",
};

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  canceled: "Canceled",
  failed: "Failed",
  rolled_back: "Rolled back",
};

export function RecentJobs() {
  const vocab = useVocabulary();
  const router = useRouter();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/import/jobs");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(true);
        setJobs([]);
        return;
      }
      setJobs(Array.isArray(json.jobs) ? (json.jobs as JobRow[]) : []);
    } catch {
      setError(true);
      setJobs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rollBack(job: JobRow) {
    const ok = await confirm({
      title: `Roll back "${job.fileName}"?`,
      body:
        `This removes the ${vocab.leadNounPlural} that import created that nobody has ` +
        `worked — up to ${formatNumber(job.created)}. Any that were dialed, updated, ` +
        `or booked stay. This can't be undone.`,
      confirmLabel: "Roll back",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(job.id);
    try {
      const res = await fetch(`/api/leads/import/jobs/${job.id}/rollback`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Rollback failed", description: String(json.error ?? ""), tone: "danger" });
        return;
      }
      toast({
        title: "Import rolled back",
        description: `${formatNumber(Number(json.removed ?? 0))} removed, ${formatNumber(Number(json.keptWorked ?? 0))} kept (already worked).`,
        tone: "success",
      });
      await load();
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold tracking-tight">Recent imports</h3>
      </div>

      {jobs === null ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : jobs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {error
            ? "Import history isn't available right now."
            : "No imports yet — your first one will be recorded here, with rollback."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className={cn(CELL, "font-semibold")}>File</th>
                <th className={cn(CELL, "font-semibold")}>Status</th>
                <th className={cn(CELL, "font-semibold")}>Rows</th>
                <th className={cn(CELL, "font-semibold")}>Created</th>
                <th className={cn(CELL, "font-semibold")}>Updated</th>
                <th className={cn(CELL, "font-semibold")}>Skipped</th>
                <th className={cn(CELL, "font-semibold")}>When</th>
                <th className={cn(CELL, "font-semibold")} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-border/50 last:border-0">
                  <td className={cn(CELL, "max-w-[220px] truncate font-medium")} title={j.fileName}>
                    {j.fileName || "Upload"}
                  </td>
                  <td className={cn(CELL)}>
                    <Badge tone={STATUS_TONE[j.status] ?? "neutral"} dot={j.status === "running"}>
                      {STATUS_LABEL[j.status] ?? j.status}
                    </Badge>
                  </td>
                  <td className={cn(CELL, "tabular")}>{formatNumber(j.rowsTotal)}</td>
                  <td className={cn(CELL, "tabular")}>{formatNumber(j.created)}</td>
                  <td className={cn(CELL, "tabular")}>{formatNumber(j.updated)}</td>
                  <td className={cn(CELL, "tabular")}>
                    {formatNumber(j.duplicates + j.dnc + j.skipped)}
                  </td>
                  <td className={cn(CELL, "text-muted-foreground")}>
                    {j.createdAt ? relativeTime(j.createdAt) : "—"}
                  </td>
                  <td className={cn(CELL)}>
                    {(j.status === "completed" ||
                      j.status === "canceled" ||
                      j.status === "failed") &&
                      j.created > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyId === j.id}
                          onClick={() => void rollBack(j)}
                          className="gap-1.5"
                        >
                          {busyId === j.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Roll back
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
