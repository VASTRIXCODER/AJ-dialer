"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = { type: "idle" | "working" | "done" | "error"; message?: string };

export function CsvImport({
  variant = "dropzone",
  campaigns = [],
}: {
  variant?: "dropzone" | "button";
  campaigns?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [campaignId, setCampaignId] = useState("");

  async function handleFile(file: File) {
    setStatus({ type: "working", message: `Reading ${file.name}…` });
    try {
      const text = await file.text();
      if (!text.trim()) {
        setStatus({ type: "error", message: "That file looks empty." });
        return;
      }
      // The server parses + maps the CSV — using Claude to read any layout
      // (including header-less broker exports) when the simple mapper can't.
      setStatus({ type: "working", message: "Reading your columns…" });
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: text, campaignId: campaignId || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        setStatus({ type: "error", message: json.error ?? "Import failed." });
        return;
      }
      const skipped = typeof json.invalidPhone === "number" ? json.invalidPhone : 0;
      const skipNote = skipped > 0 ? ` (${skipped} without a valid phone — not dialable)` : "";
      const how = json.source === "ai" ? " — columns mapped by AI" : "";
      setStatus({
        type: "done",
        message: `Imported ${json.inserted} leads${skipNote}${how}.`,
      });
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "Couldn’t read that file." });
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,text/csv"
      className="hidden"
      onChange={onPick}
    />
  );

  const campaignPicker = campaigns.length > 0 && (
    <select
      value={campaignId}
      onChange={(e) => setCampaignId(e.target.value)}
      className="h-9 rounded-xl border border-border bg-background/60 px-2.5 text-sm text-foreground transition-colors focus-visible:border-primary/50 focus-visible:outline-none"
      title="Assign imported leads to a campaign"
    >
      <option value="">No campaign</option>
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );

  const statusLine = status.message && (
    <p
      className={cn(
        "mt-3 flex items-center justify-center gap-1.5 text-xs",
        status.type === "error"
          ? "text-danger"
          : status.type === "done"
            ? "text-success"
            : "text-muted-foreground",
      )}
    >
      {status.type === "working" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : status.type === "error" ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : status.type === "done" ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : null}
      {status.message}
    </p>
  );

  if (variant === "button") {
    return (
      <>
        {hiddenInput}
        <div className="flex items-center gap-2">
          {campaignPicker}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => inputRef.current?.click()}
            disabled={status.type === "working"}
          >
            {status.type === "working" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            Import CSV
          </Button>
        </div>
        {statusLine}
      </>
    );
  }

  return (
    <div>
      {hiddenInput}
      {campaignPicker && <div className="mb-3 flex justify-center">{campaignPicker}</div>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
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
          "flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors",
          dragOver
            ? "border-primary bg-primary-soft/40"
            : "border-border bg-muted/30 hover:border-primary/40 hover:bg-primary-soft/30",
        )}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-solar text-white shadow-glow">
          <UploadCloud className="h-7 w-7" />
        </div>
        <p className="mt-4 font-semibold">Drop your CSV here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          or click to browse — columns are mapped automatically
        </p>
        <span className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border/70 px-3 py-1.5 text-sm font-medium">
          <FileSpreadsheet className="h-4 w-4" />
          Choose file
        </span>
      </button>
      {statusLine}
    </div>
  );
}
