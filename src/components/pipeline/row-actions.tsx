"use client";

import { Loader2, MoreVertical, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OutcomeGrid } from "@/components/dialer/outcome-grid";
import { Portal } from "@/components/ui/portal";
import type { CallOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusOption = { value: string; label: string };

/**
 * Per-row overrides for the Appointments / Callbacks tabs. Lets a human set the
 * row's status and — crucially — re-disposition the lead (overriding what the AI
 * filed), which re-files it across the pipeline and corrects reports.
 */
export function RowActions({
  kind,
  id,
  leadId,
  statusOptions,
}: {
  kind: "appointment" | "callback";
  id: string;
  leadId: string | null;
  statusOptions: StatusOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [redispo, setRedispo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "Couldn't save the change.");
        return;
      }
      setOpen(false);
      setRedispo(false);
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const item =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Row actions"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-border bg-popover p-1 shadow-lift">
          <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Set status
          </p>
          {statusOptions.map((o) => (
            <button key={o.value} type="button" className={item} onClick={() => post({ action: kind, id, status: o.value })}>
              {o.label}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            className={cn(item, !leadId && "cursor-not-allowed opacity-40")}
            disabled={!leadId}
            onClick={() => {
              if (!leadId) return;
              setRedispo(true);
              setOpen(false);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Change disposition…
          </button>
          {!leadId && (
            <p className="px-2.5 pb-1 text-[10px] text-muted-foreground">No lead linked to re-file.</p>
          )}
        </div>
      )}

      {err && !open && !redispo && (
        <p className="absolute right-0 z-30 mt-1 whitespace-nowrap text-[10px] font-medium text-danger">
          {err}
        </p>
      )}

      {redispo && (
        <Portal>
          <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
            <div
              className="absolute inset-0 bg-background/70 backdrop-blur-xl"
              onClick={() => setRedispo(false)}
            />
            <div className="glass relative w-full max-w-md rounded-t-2xl border border-border/60 p-5 shadow-lift sm:rounded-2xl">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="text-base font-semibold">Change disposition</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Override the AI&apos;s outcome — this re-files the lead and updates reports.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRedispo(false)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {busy ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <OutcomeGrid onSelect={(outcome: CallOutcome) => post({ action: "disposition", leadId, outcome })} />
              )}
              {err && <p className="mt-3 text-sm font-medium text-danger">{err}</p>}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
