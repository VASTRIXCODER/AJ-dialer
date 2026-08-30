"use client";

import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, relativeTime } from "@/lib/utils";
import { SelectMenu } from "@/components/ui/select-menu";

interface Pack {
  id: string;
  batch: string;
  seq: number;
  label: string;
  size: number;
  assignedTo: string | null;
  assignedToName: string;
  assignedAt: string | null;
  progress: { total: number; worked: number; remaining: number; appointments: number };
}

/**
 * Deal the packs an upload was cut into out to reps.
 *
 * Packs themselves are created at import (see lib/db/lead-packs.ts) — a
 * 10,000-row file becomes "Jan list · Pack 1…100". What was missing was any way
 * to hand one to somebody: assignment lived only on individual leads, so
 * "give Marcus packs 1-5" meant hand-ticking 500 rows, and nothing recorded who
 * was holding what.
 */
export function LeadPacksPanel({ members }: { members: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leads/packs", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (Array.isArray(json.packs)) setPacks(json.packs as Pack[]);
      else if (json.error) setErr(String(json.error));
    } catch {
      /* leave the list as-is rather than blanking it on a hiccup */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function assign(packId: string, repId: string | null) {
    setBusy(packId);
    setErr("");
    try {
      const res = await fetch("/api/leads/packs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId, repId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Couldn't update that pack.");
        return;
      }
      await load();
      router.refresh();
    } catch {
      setErr("Network error while assigning.");
    } finally {
      setBusy(null);
    }
  }

  const shown = onlyUnassigned ? packs.filter((p) => !p.assignedTo) : packs;
  const unassignedCount = packs.filter((p) => !p.assignedTo).length;

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Boxes className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-semibold tracking-tight">Lead packs</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Hand a rep a pack and track how far they get through it
            </p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-5">
          {err && (
            <p className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {err}
            </p>
          )}

          {packs.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyUnassigned}
                  onChange={(e) => setOnlyUnassigned(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-input accent-primary"
                />
                Only unassigned ({unassignedCount})
              </label>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="ml-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className={cn("h-3 w-3", loading && "animate-spin")} />
                Refresh progress
              </button>
            </div>
          )}

          {loading && packs.length === 0 ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading packs…
            </p>
          ) : shown.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {packs.length === 0
                ? "No packs yet — import a CSV with a pack size set and its leads get cut into numbered packs you can deal out here."
                : "Every pack is assigned."}
            </p>
          ) : (
            <div className="space-y-2">
              {shown.map((p) => {
                const pct =
                  p.progress.total > 0
                    ? Math.round((p.progress.worked / p.progress.total) * 100)
                    : 0;
                return (
                  <div key={p.id} className="rounded-xl border border-border/70 bg-surface/30 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          {p.label || `${p.batch} · Pack ${p.seq}`}
                          {p.assignedTo ? (
                            <Badge tone="primary">{p.assignedToName}</Badge>
                          ) : (
                            <Badge tone="neutral">Unassigned</Badge>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {p.progress.total || p.size} lead
                          {(p.progress.total || p.size) === 1 ? "" : "s"}
                          {p.assignedAt ? ` · handed over ${relativeTime(p.assignedAt)}` : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <SelectMenu
                          label={`Assign ${p.label || `pack ${p.seq}`} to`}
                          placeholder="Assign to…"
                          size="sm"
                          triggerClassName="h-9"
                          value={p.assignedTo ?? null}
                          disabled={busy === p.id}
                          disabledReason="Saving…"
                          onChange={(v) => assign(p.id, v || null)}
                          options={members.map((m) => ({
                            value: m.id,
                            label: m.name || "Teammate",
                          }))}
                        />
                        {p.assignedTo && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled={busy === p.id}
                            onClick={() => assign(p.id, null)}
                            title="Return this pack's remaining leads to the unassigned pool"
                          >
                            {busy === p.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Undo2 className="h-3.5 w-3.5" />
                            )}
                            Reclaim
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            pct === 100 ? "bg-success" : "bg-primary",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-xs font-medium tabular text-muted-foreground">
                        {p.progress.worked}/{p.progress.total} worked
                      </span>
                      {p.progress.appointments > 0 && (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {p.progress.appointments}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
