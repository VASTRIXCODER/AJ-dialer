"use client";

import { FlaskConical, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { splitCsvIntoChunks } from "@/lib/leads/chunk";
import type { ColumnPlan } from "@/lib/leads/parse-request";
import { cn, formatNumber } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Dedupe step: what happens when a number in the file already exists here.
// Three modes in plain language, plus a dry run that answers with the SAME
// probe the real write uses — so "what would happen" is what happens.
// ─────────────────────────────────────────────────────────────────────────────

export type DedupeMode = "skip" | "update" | "create_new";

const MODES: { id: DedupeMode; title: string; body: string }[] = [
  {
    id: "skip",
    title: "Skip duplicates",
    body: "A number already in your workspace is left exactly as it is; the file's row is skipped. The safe default.",
  },
  {
    id: "update",
    title: "Update existing records",
    body: "A match fills in ONLY fields that are currently empty (plus any custom fields). Status, owner, and assignments are never touched.",
  },
  {
    id: "create_new",
    title: "Import everything as new",
    body: "Every row becomes a new record, even when the number already exists. Use for deliberate re-imports — this WILL create copies.",
  },
];

interface DryRunResult {
  wouldCreate: number;
  wouldUpdate: number;
  wouldSkip: number;
  dnc: number;
  invalid: number;
}

export function DedupeStep({
  mode,
  onModeChange,
  fileText,
  hasHeader,
  delimiter,
  plan,
  leadNounPlural,
  footer,
}: {
  mode: DedupeMode;
  onModeChange: (m: DedupeMode) => void;
  fileText: string;
  hasHeader: boolean;
  delimiter?: string;
  plan: ColumnPlan;
  leadNounPlural: string;
  footer: ReactNode;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [resultMode, setResultMode] = useState<DedupeMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function dryRun() {
    setRunning(true);
    setError(null);
    try {
      // Dry-run the FIRST chunk — same cut the real upload makes.
      const chunks = splitCsvIntoChunks(fileText, {
        maxRows: 4000,
        maxBytes: 3_000_000,
        hasHeader,
      });
      if (!chunks.length) {
        setError("Nothing to dry-run in this file.");
        return;
      }
      const res = await fetch("/api/leads/import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csv: chunks[0].csv,
          hasHeader,
          ...(delimiter ? { delimiter } : {}),
          columnPlan: plan,
          dedupeMode: mode,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(json.error ?? "Dry run failed."));
        return;
      }
      setResult(json as DryRunResult);
      setResultMode(mode);
    } catch {
      setError("Dry run failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="font-semibold tracking-tight">
          When a number is already in your {leadNounPlural}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3" role="radiogroup">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => onModeChange(m.id)}
              className={cn(
                "rounded-2xl border p-4 text-left transition-colors",
                mode === m.id
                  ? "border-primary bg-primary-soft/40 ring-1 ring-inset ring-primary/30"
                  : "border-border bg-surface/40 hover:border-primary/40",
              )}
            >
              <p className="text-sm font-semibold">{m.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.body}</p>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void dryRun()}
            disabled={running}
            className="gap-1.5"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="h-4 w-4" />
            )}
            Dry run
          </Button>
          <p className="text-xs text-muted-foreground">
            Checks the first 4,000 rows against your workspace. Writes nothing.
          </p>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {result && resultMode && (
          <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
            <Chip label="Would create" value={result.wouldCreate} tone="success" />
            {resultMode === "update" && (
              <Chip label="Would update" value={result.wouldUpdate} tone="accent" />
            )}
            <Chip label="Would skip" value={result.wouldSkip} />
            <Chip label="On your DNC list" value={result.dnc} tone="warning" />
            <Chip label="Invalid phone" value={result.invalid} />
            {resultMode !== mode && (
              <p className="w-full text-xs text-muted-foreground">
                This dry run used "{MODES.find((m) => m.id === resultMode)?.title}" —
                run it again to preview the current choice.
              </p>
            )}
          </div>
        )}
      </Card>

      {footer}
    </div>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "accent" && "bg-accent-soft text-accent",
        !tone && "bg-muted text-muted-foreground",
      )}
    >
      <span className="tabular">{formatNumber(value)}</span>
      {label}
    </span>
  );
}
