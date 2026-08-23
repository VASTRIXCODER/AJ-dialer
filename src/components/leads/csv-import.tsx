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
import {
  describeImport,
  importCsvInChunks,
  importShortfall,
} from "@/lib/leads/import-client";
import { cn } from "@/lib/utils";
import { CampaignCertificationDialog } from "./campaign-certification-dialog";

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
  // Set when /api/leads/import blocks on an uncertified campaign — the file's
  // already-read text is kept so certifying can retry the SAME import without
  // asking the rep to re-pick or re-drop the file.
  const [certPrompt, setCertPrompt] = useState<{ campaignId: string | null } | null>(null);
  const pendingTextRef = useRef<string | null>(null);

  async function runImport(text: string) {
    // The server parses + maps the CSV, running Claude's column mapping against
    // the deterministic header mapper and keeping whichever read the file better.
    // Big files go up as several ordered requests — see lib/leads/import-client.ts
    // — and what's reported here is the SUM, with a warning if any row of the
    // file can't be accounted for.
    setStatus({ type: "working", message: "Reading your columns…" });
    const outcome = await importCsvInChunks(
      text,
      { campaignId: campaignId || null },
      (sent, total) => {
        if (total > 1) {
          setStatus({
            type: "working",
            message: `Importing… part ${Math.min(sent + 1, total)} of ${total}`,
          });
        }
      },
    );

    if (!outcome.ok) {
      if (outcome.certificationRequired) {
        pendingTextRef.current = text;
        setCertPrompt({ campaignId: outcome.campaignId ?? null });
        setStatus({ type: "idle" });
        return;
      }
      const landed = outcome.totals.inserted
        ? ` ${outcome.totals.inserted} leads were imported before it stopped.`
        : "";
      setStatus({ type: "error", message: `${outcome.error}${landed}` });
      router.refresh();
      return;
    }

    const { totals } = outcome;
    const shortfall = importShortfall(totals);
    // If the file needed AI mapping but it wasn't available/failed, the import
    // still ran with best-effort header detection — warn so it's not silent.
    if (totals.aiError) {
      setStatus({
        type: "error",
        message: `Imported ${totals.inserted} leads, but ${totals.aiError}`,
      });
    } else if (shortfall) {
      setStatus({ type: "error", message: `${describeImport(totals)} ${shortfall}` });
    } else {
      setStatus({ type: "done", message: describeImport(totals) });
    }
    router.refresh();
  }

  async function handleFile(file: File) {
    setStatus({ type: "working", message: `Reading ${file.name}…` });
    try {
      const text = await file.text();
      if (!text.trim()) {
        setStatus({ type: "error", message: "That file looks empty." });
        return;
      }
      await runImport(text);
    } catch {
      setStatus({ type: "error", message: "Couldn’t read that file." });
    }
  }

  async function certifyAndRetry() {
    const text = pendingTextRef.current;
    if (!text) return;
    setCertPrompt(null);
    try {
      await runImport(text);
    } catch {
      setStatus({ type: "error", message: "Couldn’t read that file." });
    }
  }

  function cancelCert() {
    pendingTextRef.current = null;
    setCertPrompt(null);
    setStatus({ type: "idle" });
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

  const certDialog = certPrompt && (
    <CampaignCertificationDialog
      campaignId={certPrompt.campaignId}
      onCertified={certifyAndRetry}
      onCancel={cancelCert}
    />
  );

  if (variant === "button") {
    return (
      <>
        {hiddenInput}
        {certDialog}
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
      {certDialog}
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
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-glow">
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
