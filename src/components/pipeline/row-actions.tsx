"use client";

import { Loader2, MoreVertical, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OutcomeGrid } from "@/components/dialer/outcome-grid";
import { Modal } from "@/components/ui/modal";
import { Portal } from "@/components/ui/portal";
import type { CallOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusOption = { value: string; label: string };

const MENU_W = 224; // w-56

/**
 * Per-row overrides for the Appointments / Callbacks tabs. Lets a human set the
 * row's status and — crucially — re-disposition the lead (overriding what the AI
 * filed), which re-files it across the pipeline and corrects reports.
 *
 * The menu renders in a Portal with fixed positioning so it never gets clipped
 * by the card's overflow (the old absolute menu was cut off).
 */
export function RowActions({
  kind,
  id,
  leadId,
  statusOptions,
}: {
  kind: "appointment" | "callback" | "lead";
  id: string;
  leadId: string | null;
  statusOptions: StatusOption[];
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [redispo, setRedispo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const open = pos !== null;

  function openMenu() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const estHeight = 92 + statusOptions.length * 36;
    const openUp = r.bottom + estHeight > window.innerHeight && r.top > estHeight;
    setPos({
      top: openUp ? r.top - estHeight - 6 : r.bottom + 6,
      left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
    });
  }

  // Close on scroll / resize / Escape so the fixed menu never floats out of place.
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function buildBody(extra: Record<string, unknown>): Record<string, unknown> {
    if (kind === "lead") {
      // For lead rows, status changes are dispositions (outcome re-files the lead).
      return { action: "disposition", leadId: id, outcome: extra.status ?? extra.outcome };
    }
    return { action: kind, id, ...extra };
  }

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
      setPos(null);
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
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setPos(null) : openMenu())}
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          open && "bg-muted text-foreground",
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>

      {open && pos && (
        <Portal>
          {/* Outside-click catcher */}
          <div className="fixed inset-0 z-[90]" onClick={() => setPos(null)} />
          <div
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
            className="z-[91] rounded-xl border border-border bg-popover p-1 shadow-lift"
          >
            <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Set status
            </p>
            {statusOptions.map((o) => (
              <button key={o.value} type="button" className={item} onClick={() => post(buildBody({ status: o.value }))}>
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
                setPos(null);
                setRedispo(true);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Change disposition…
            </button>
            {!leadId && (
              <p className="px-2.5 pb-1 text-[11px] text-muted-foreground">No lead linked to re-file.</p>
            )}
          </div>
        </Portal>
      )}

      {err && !open && !redispo && (
        <span className="ml-1 text-[11px] font-medium text-danger">{err}</span>
      )}

      {redispo && (
        <Modal
          onClose={() => setRedispo(false)}
          label="Change disposition"
          maxWidth="max-w-md"
          panelClassName="p-5"
        >
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
            <OutcomeGrid
              onSelect={(outcome: CallOutcome, dispositionKey: string) =>
                post({ action: "disposition", leadId, outcome, dispositionKey })
              }
            />
          )}
          {err && <p className="mt-3 text-sm font-medium text-danger">{err}</p>}
        </Modal>
      )}
    </>
  );
}
