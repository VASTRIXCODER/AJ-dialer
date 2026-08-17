"use client";

import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { applyLabelOverride } from "@/lib/leads/group-labels";
import { LEAD_GROUPS } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";

const GROUP_LABELS: Record<string, string> = {
  fresno: "Fresno",
  houston: "Houston",
  dallas: "Dallas",
  california: "California",
  manual: "Manual Dialing",
};

interface Pack {
  id: string;
  name: string;
  assignedTo: string | null;
  assignedToName: string;
  size: number;
  source: { leadGroup?: string | null; campaignId?: string | null; onlyUnassigned?: boolean };
  status: "active" | "reclaimed";
  createdAt: string;
  progress: { total: number; worked: number; remaining: number; appointments: number };
}

/**
 * Hand a rep a named batch of leads and watch them work through it.
 *
 * Bulk-assign already existed, but only over rows hand-ticked in the table —
 * unusable past a screenful, and it left no record of what was handed out. A
 * pack is cut by FILTER + SIZE ("200 unassigned Houston leads"), so the size of
 * the batch is unrelated to how many rows happen to be on screen.
 */
export function LeadPacksPanel({
  members,
  campaigns = [],
  labelOverrides,
}: {
  members: { id: string; name: string }[];
  campaigns?: { id: string; name: string }[];
  labelOverrides?: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [repId, setRepId] = useState("");
  const [size, setSize] = useState(100);
  const [group, setGroup] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [available, setAvailable] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leads/packs", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (Array.isArray(json.packs)) setPacks(json.packs as Pack[]);
    } catch {
      /* leave the list as-is rather than blanking it on a hiccup */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Live "how many leads would this cut?" as the filter changes, so nobody
  // hands over a pack of 200 from a pool that only has 12 left.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/leads/packs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            preview: true,
            source: {
              leadGroup: group || null,
              campaignId: campaignId || null,
              onlyUnassigned,
            },
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && typeof json.available === "number") setAvailable(json.available);
      } catch {
        if (!cancelled) setAvailable(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, group, campaignId, onlyUnassigned]);

  async function create() {
    setBusy("create");
    setErr("");
    try {
      const res = await fetch("/api/leads/packs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          repId,
          size,
          source: { leadGroup: group || null, campaignId: campaignId || null, onlyUnassigned },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Couldn't create that pack.");
        return;
      }
      setName("");
      await load();
      router.refresh();
    } catch {
      setErr("Network error while creating the pack.");
    } finally {
      setBusy(null);
    }
  }

  async function reclaim(packId: string) {
    setBusy(packId);
    setErr("");
    try {
      const res = await fetch("/api/leads/packs/reclaim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Couldn't reclaim that pack.");
        return;
      }
      await load();
      router.refresh();
    } catch {
      setErr("Network error while reclaiming.");
    } finally {
      setBusy(null);
    }
  }

  const canCreate =
    Boolean(name.trim()) && Boolean(repId) && size > 0 && (available ?? 0) > 0 && !busy;

  const select =
    "h-9 rounded-lg border border-border bg-background/60 px-2.5 text-sm font-medium focus-visible:border-primary/50 focus-visible:outline-none";

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
              Hand a rep a named batch of leads and track how far they get
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
        <div className="space-y-4 border-t border-border p-5">
          {err && (
            <p className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {err}
            </p>
          )}

          {/* ── Build a pack ── */}
          <div className="rounded-xl border border-border/70 bg-surface/40 p-4">
            <p className="text-sm font-semibold">Build a pack</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Pack name — e.g. Houston Batch 3"
                className="h-9 min-w-[200px] flex-1 rounded-lg border border-border bg-background/60 px-3 text-sm focus-visible:border-primary/50 focus-visible:outline-none"
              />
              <select
                value={repId}
                onChange={(e) => setRepId(e.target.value)}
                aria-label="Assign to"
                className={select}
              >
                <option value="">Assign to…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || "Teammate"}
                  </option>
                ))}
              </select>
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                aria-label="Lead group"
                className={select}
              >
                <option value="">Any group</option>
                {LEAD_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {applyLabelOverride(g, GROUP_LABELS[g] ?? g, labelOverrides)}
                  </option>
                ))}
              </select>
              {campaigns.length > 0 && (
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  aria-label="Campaign"
                  className={select}
                >
                  <option value="">Any campaign</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="number"
                min={1}
                value={size}
                onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 0))}
                aria-label="Pack size"
                className="h-9 w-24 rounded-lg border border-border bg-background/60 px-2.5 text-sm tabular focus-visible:border-primary/50 focus-visible:outline-none"
              />
              <Button size="sm" className="gap-1.5" onClick={create} disabled={!canCreate}>
                {busy === "create" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Package className="h-3.5 w-3.5" />
                )}
                Assign pack
              </Button>
            </div>

            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyUnassigned}
                onChange={(e) => setOnlyUnassigned(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              Only leads nobody is working yet
              {/* Off, a pack can pull leads already assigned to someone else —
                  which silently takes them off that rep's list. */}
            </label>

            <p className="mt-2 text-xs text-muted-foreground">
              {available == null ? (
                "Checking how many leads match…"
              ) : available === 0 ? (
                <span className="text-warning">No dialable leads match that filter.</span>
              ) : (
                <>
                  <span className="font-semibold tabular text-foreground">{available}</span> lead
                  {available === 1 ? "" : "s"} available — the pack takes the first{" "}
                  <span className="font-semibold tabular text-foreground">
                    {Math.min(size, available)}
                  </span>{" "}
                  in upload order.
                </>
              )}
            </p>
          </div>

          {/* ── Existing packs ── */}
          {loading && packs.length === 0 ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading packs…
            </p>
          ) : packs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No packs yet — build one above to hand a rep their next batch.
            </p>
          ) : (
            <div className="space-y-2">
              {packs.map((p) => {
                const pct =
                  p.progress.total > 0
                    ? Math.round((p.progress.worked / p.progress.total) * 100)
                    : 0;
                return (
                  <div
                    key={p.id}
                    className="rounded-xl border border-border/70 bg-surface/30 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          {p.name}
                          {p.status === "reclaimed" ? (
                            <Badge tone="neutral">Reclaimed</Badge>
                          ) : (
                            <Badge tone="primary">{p.assignedToName || "Unassigned"}</Badge>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {p.size} lead{p.size === 1 ? "" : "s"}
                          {p.source.leadGroup
                            ? ` · ${applyLabelOverride(
                                p.source.leadGroup,
                                GROUP_LABELS[p.source.leadGroup] ?? p.source.leadGroup,
                                labelOverrides,
                              )}`
                            : ""}
                          {p.createdAt ? ` · ${relativeTime(p.createdAt)}` : ""}
                        </p>
                      </div>
                      {p.status === "active" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => reclaim(p.id)}
                          disabled={busy === p.id}
                          title="Return these leads to the unassigned pool"
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
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className={cn("h-3 w-3", loading && "animate-spin")} />
                Refresh progress
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
