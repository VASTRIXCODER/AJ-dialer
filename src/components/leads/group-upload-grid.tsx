"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import type { LeadGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GeoPreviewReview, type GeoPreviewResponse } from "./geo-preview-review";
import { useCsvUpload } from "./use-csv-upload";

const TILES: { group: LeadGroup; label: string; hint: string }[] = [
  { group: "fresno", label: "Fresno", hint: "Fresno metro leads" },
  { group: "houston", label: "Houston", hint: "Houston metro leads" },
  { group: "dallas", label: "Dallas", hint: "Dallas metro leads" },
  { group: "california", label: "California", hint: "Other California leads" },
  { group: "manual", label: "Manual Dialing", hint: "Leads a human will dial by hand" },
];

function UploadTile({ group, label, hint }: { group: LeadGroup; label: string; hint: string }) {
  const { status, handleFile } = useCsvUpload({ leadGroup: group });
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status.type === "working"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-5 text-center transition-colors disabled:opacity-60",
          dragOver
            ? "border-primary bg-primary-soft/40"
            : "border-border bg-muted/30 hover:border-primary/40 hover:bg-primary-soft/30",
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-solar text-white shadow-glow">
          {status.type === "working" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <UploadCloud className="h-5 w-5" />
          )}
        </div>
        <p className="mt-1 text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </button>
      {status.message && (
        <p
          className={cn(
            "mt-2 flex items-center justify-center gap-1.5 text-center text-xs",
            status.type === "error"
              ? "text-danger"
              : status.type === "done"
                ? "text-success"
                : "text-muted-foreground",
          )}
        >
          {status.type === "error" ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          ) : status.type === "done" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : null}
          {status.message}
        </p>
      )}
    </div>
  );
}

/**
 * The 6th tile: dump one CSV and let Claude classify each lead's geography.
 * Nothing is inserted here — a successful classification hands the proposed
 * grouping to the parent, which swaps in the preview/confirm review screen.
 * No lead ever lands in "Manual Dialing" through this path (see geo-classify.ts).
 */
function AutoSortTile({ onPreview }: { onPreview: (p: GeoPreviewResponse) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<{ type: "idle" | "working" | "error"; message?: string }>({
    type: "idle",
  });

  async function handleFile(file: File) {
    setStatus({ type: "working", message: `Reading ${file.name}…` });
    try {
      const text = await file.text();
      if (!text.trim()) {
        setStatus({ type: "error", message: "That file looks empty." });
        return;
      }
      setStatus({ type: "working", message: "Sorting by geography…" });
      const res = await fetch("/api/leads/geo-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        setStatus({ type: "error", message: json.error ?? "Couldn't sort that file." });
        return;
      }
      setStatus({ type: "idle" });
      onPreview(json as GeoPreviewResponse);
    } catch {
      setStatus({ type: "error", message: "Couldn't read that file." });
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status.type === "working"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-5 text-center transition-colors disabled:opacity-60",
          dragOver
            ? "border-accent bg-accent-soft/40"
            : "border-accent/40 bg-accent-soft/20 hover:border-accent/60 hover:bg-accent-soft/30",
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white shadow-glow">
          {status.type === "working" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
        </div>
        <p className="mt-1 text-sm font-semibold">Auto-sort with AI</p>
        <p className="text-xs text-muted-foreground">Dump everything — Claude sorts it</p>
      </button>
      {status.message && (
        <p
          className={cn(
            "mt-2 flex items-center justify-center gap-1.5 text-center text-xs",
            status.type === "error" ? "text-danger" : "text-muted-foreground",
          )}
        >
          {status.type === "error" && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
          {status.message}
        </p>
      )}
    </div>
  );
}

/**
 * Specialized lead intake: one dropzone per fixed group (Fresno / Houston /
 * Dallas / California / Manual Dialing), each stamping every imported row with
 * that group — no AI involved, the group is explicit by construction — plus a
 * 6th "Auto-sort with AI" dropzone that hands off to the preview/confirm review
 * screen instead of importing immediately. Replaces the single "Import CSV"
 * button that used to sit in the Leads page header.
 */
export function GroupUploadGrid({ canImport }: { canImport: boolean }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<GeoPreviewResponse | null>(null);

  if (!canImport) return null;

  if (preview) {
    return (
      <GeoPreviewReview
        preview={preview}
        onDone={() => setPreview(null)}
        onCancel={() => setPreview(null)}
      />
    );
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
      >
        <div>
          <h3 className="font-semibold tracking-tight">Import leads by group</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Drop a CSV into the group it belongs to, or dump everything and let AI sort it
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-3 border-t border-border p-5 sm:grid-cols-3 lg:grid-cols-6">
          {TILES.map((t) => (
            <UploadTile key={t.group} {...t} />
          ))}
          <AutoSortTile onPreview={setPreview} />
        </div>
      )}
    </Card>
  );
}
