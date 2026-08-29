"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  UploadCloud,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { CampaignCertificationDialog } from "@/components/leads/campaign-certification-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { guessHasHeader, parseSheet } from "@/lib/leads/csv";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import {
  importCsvInChunks,
  importShortfall,
  type ImportTotals,
} from "@/lib/leads/import-client";
import type { ColumnPlan } from "@/lib/leads/parse-request";
import { takePendingFile } from "@/lib/leads/pending-import";
import { cn, formatNumber } from "@/lib/utils";
import { DedupeStep, type DedupeMode } from "./dedupe-step";
import { DestinationStep, type Destination } from "./destination-step";
import { MappingStep } from "./mapping-step";
import {
  buildHeadersPlan,
  targetsFromInspection,
  type ColumnTarget,
  type InspectedColumn,
} from "./plan";
import { RecentJobs } from "./recent-jobs";

// ─────────────────────────────────────────────────────────────────────────────
// The Import Studio — the guided, observable, rollbackable replacement for the
// silent drop-import. Six steps: Upload → Mapping → Dedupe → Destination →
// Run → Report. Every decision the old importer made silently (is row 0 a
// header? which column is which? what happens to duplicates?) is now a visible
// choice with a preset, and every row of the file ends the run accounted for
// on an import job that can be rolled back.
// ─────────────────────────────────────────────────────────────────────────────

type Step = "upload" | "mapping" | "dedupe" | "destination" | "run" | "report";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "mapping", label: "Mapping" },
  { id: "dedupe", label: "Duplicates" },
  { id: "destination", label: "Destination" },
  { id: "run", label: "Import" },
  { id: "report", label: "Report" },
];

type DelimiterChoice = "auto" | "," | "\t" | ";";

interface InspectResult {
  plan: ColumnPlan | null;
  columns: InspectedColumn[];
  guessedHasHeader: boolean;
  delimiter: string;
  source: "headers" | "ai" | null;
  aiError: string | null;
  error: string | null;
  rows: number;
}

/** Cut the head of the file for inspection at a line boundary, ≤ ~480 KB. */
function headOf(text: string): string {
  if (text.length <= 480_000) return text;
  const cut = text.lastIndexOf("\n", 480_000);
  return text.slice(0, cut > 0 ? cut : 480_000);
}

export function ImportStudio({
  fields,
  groups,
  campaigns,
  initialGroup,
}: {
  /** The org's resolved lead-field schema — mapping targets read ITS labels. */
  fields: LeadFieldDef[];
  groups: { key: string; label: string }[];
  campaigns: { id: string; name: string }[];
  /** ?group= from the tile that navigated here ("__misc__" = Miscellaneous). */
  initialGroup: string | null;
}) {
  const vocab = useVocabulary();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [delimiter, setDelimiter] = useState<DelimiterChoice>("auto");
  const [hasHeader, setHasHeader] = useState(true);

  const [inspecting, setInspecting] = useState(false);
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [targets, setTargets] = useState<ColumnTarget[]>([]);

  const [dedupeMode, setDedupeMode] = useState<DedupeMode>("skip");
  const [dest, setDest] = useState<Destination>({
    group: initialGroup && initialGroup !== "__misc__" ? initialGroup : "__misc__",
    campaignId: "",
    packBy: "none",
    packSize: 100,
  });

  const [jobId, setJobId] = useState<string | null>(null);
  const [runState, setRunState] = useState<{
    running: boolean;
    sent: number;
    total: number;
    error: string | null;
  }>({ running: false, sent: 0, total: 0, error: null });
  const [certPrompt, setCertPrompt] = useState<{ campaignId: string | null } | null>(null);
  const [totals, setTotals] = useState<ImportTotals | null>(null);
  const [rolledBack, setRolledBack] = useState<{ removed: number; kept: number } | null>(null);
  const cancelRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A file dropped on a group tile rides over the client navigation in memory.
  useEffect(() => {
    const pending = takePendingFile();
    if (pending) void onFile(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const delimiterParam = delimiter === "auto" ? undefined : delimiter;

  // Instant client-side preview grid (~100 records) — csv.ts is isomorphic.
  const previewGrid = useMemo(() => {
    if (!fileText) return [];
    return parseSheet(headOf(fileText).slice(0, 200_000), delimiterParam).slice(0, 100);
  }, [fileText, delimiterParam]);

  async function onFile(file: File) {
    setFileError(null);
    const name = file.name;
    if (/\.xlsx?$/i.test(name)) {
      // HONEST, not aspirational: we do not read XLSX yet.
      setFileError(
        "Excel workbooks aren't supported yet — export the sheet as CSV and drop that instead. XLSX import is planned.",
      );
      return;
    }
    if (!/\.(csv|tsv|txt)$/i.test(name)) {
      setFileError("Drop a .csv, .tsv, or .txt file.");
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      if (!text.trim()) {
        setFileError("That file looks empty.");
        return;
      }
      setFileName(name);
      setFileText(text);
      setDelimiter(/\.tsv$/i.test(name) ? "\t" : "auto");
      // PRESET only — the human confirms. Silent guessing is the original bug.
      setHasHeader(guessHasHeader(parseSheet(headOf(text).slice(0, 100_000))));
      setInspect(null);
      setTargets([]);
      setTotals(null);
      setJobId(null);
      setRolledBack(null);
    } catch {
      setFileError("Couldn't read that file.");
    } finally {
      setReading(false);
    }
  }

  async function toMapping() {
    setInspecting(true);
    try {
      const res = await fetch("/api/leads/import/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csvHead: headOf(fileText),
          hasHeader,
          ...(delimiterParam ? { delimiter: delimiterParam } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as InspectResult & {
        error?: string | null;
      };
      if (!res.ok) {
        setFileError(json.error ?? "Couldn't inspect that file.");
        return;
      }
      setInspect(json);
      setTargets(targetsFromInspection(json.columns ?? []));
      setStep("mapping");
    } catch {
      setFileError("Couldn't inspect that file.");
    } finally {
      setInspecting(false);
    }
  }

  const columnHeaders = useMemo(
    () => (inspect?.columns ?? []).map((c) => c.header),
    [inspect],
  );

  const plan = useMemo(
    () => buildHeadersPlan(targets, hasHeader, columnHeaders),
    [targets, hasHeader, columnHeaders],
  );

  const phoneMapped = targets.some((t) => t.kind === "core" && t.field === "phone");

  function importBase(withJob: string | null): Record<string, unknown> {
    return {
      ...(withJob ? { jobId: withJob } : {}),
      hasHeader,
      dedupeMode,
      ...(delimiterParam ? { delimiter: delimiterParam } : {}),
      sourceFile: fileName,
      columnPlan: plan,
      ...(dest.campaignId ? { campaignId: dest.campaignId } : {}),
      leadGroup: dest.group === "__misc__" ? null : dest.group,
      ...(dest.packBy !== "none" && dest.packSize > 0
        ? {
            packSize: dest.packSize,
            packBatch: fileName.replace(/\.(csv|tsv|txt)$/i, ""),
            packBy: dest.packBy,
          }
        : {}),
    };
  }

  async function startRun() {
    setStep("run");
    setRunState({ running: true, sent: 0, total: 0, error: null });
    cancelRef.current = false;

    // The job is the ledger every chunk accounts against. Demo mode (no
    // Supabase) gets no job — the run still works, it just isn't rollbackable.
    let job: string | null = jobId;
    if (!job) {
      try {
        const res = await fetch("/api/leads/import/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileName,
            hasHeader,
            delimiter: delimiterParam ?? ",",
            dedupeMode,
            destination: {
              group: dest.group,
              campaignId: dest.campaignId || null,
              packBy: dest.packBy,
              packSize: dest.packBy === "none" ? 0 : dest.packSize,
            },
            columnPlan: plan,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.jobId) {
          job = String(json.jobId);
          setJobId(job);
        }
      } catch {
        // No job — proceed untracked rather than blocking the import.
      }
    }

    const outcome = await importCsvInChunks(
      fileText,
      importBase(job),
      (sent, total) => setRunState((s) => ({ ...s, sent, total })),
      { hasHeader, isCancelled: () => cancelRef.current },
    );

    if (!outcome.ok && outcome.certificationRequired) {
      setCertPrompt({ campaignId: outcome.campaignId ?? null });
      setRunState((s) => ({ ...s, running: false }));
      return;
    }

    setTotals(outcome.totals);
    if (job) {
      // Stamp the job finished (canceled if the user stopped it mid-file).
      await fetch(`/api/leads/import/jobs/${job}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: cancelRef.current ? "cancel" : "complete",
        }),
      }).catch(() => undefined);
    }
    setRunState((s) => ({
      ...s,
      running: false,
      error: outcome.ok ? null : outcome.error,
    }));
    setStep("report");
    router.refresh();
  }

  async function rollBack() {
    if (!jobId || !totals) return;
    const ok = await confirm({
      title: "Roll this import back?",
      body:
        `This removes the ${vocab.leadNounPlural} this import created that nobody has ` +
        `worked — up to ${formatNumber(totals.inserted)} of them. Any that were ` +
        `dialed, updated, or booked stay. This can't be undone.`,
      confirmLabel: "Roll back",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/leads/import/jobs/${jobId}/rollback`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Rollback failed", description: String(json.error ?? ""), tone: "danger" });
        return;
      }
      setRolledBack({ removed: Number(json.removed ?? 0), kept: Number(json.keptWorked ?? 0) });
      toast({
        title: "Import rolled back",
        description: `${formatNumber(Number(json.removed ?? 0))} removed, ${formatNumber(Number(json.keptWorked ?? 0))} kept (already worked).`,
        tone: "success",
      });
      router.refresh();
    } catch {
      toast({ title: "Rollback failed", tone: "danger" });
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="space-y-6">
      {/* Step rail */}
      <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/50">→</span>}
            <span
              aria-current={s.id === step ? "step" : undefined}
              className={cn(
                "rounded-lg px-2.5 py-1 font-semibold",
                s.id === step
                  ? "bg-primary text-white"
                  : i < stepIndex
                    ? "bg-primary-soft text-primary"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      {certPrompt && (
        <CampaignCertificationDialog
          campaignId={certPrompt.campaignId}
          onCertified={() => {
            setCertPrompt(null);
            void startRun();
          }}
          onCancel={() => {
            setCertPrompt(null);
            setStep("destination");
          }}
        />
      )}

      {step === "upload" && (
        <div className="space-y-6">
          <Card className="p-6">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
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
                if (f) void onFile(f);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors",
                dragOver
                  ? "border-primary bg-primary-soft/40"
                  : "border-border bg-muted/30 hover:border-primary/40 hover:bg-primary-soft/30",
              )}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-glow">
                {reading ? (
                  <Loader2 className="h-7 w-7 animate-spin" />
                ) : (
                  <UploadCloud className="h-7 w-7" />
                )}
              </div>
              <p className="mt-4 font-semibold">
                {fileName ? fileName : "Drop your file here"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                CSV, TSV, or TXT — every column is reviewed with you before anything imports
              </p>
              <span className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border/70 px-3 py-1.5 text-sm font-medium">
                <FileSpreadsheet className="h-4 w-4" />
                {fileName ? "Choose a different file" : "Choose file"}
              </span>
            </button>
            {fileError && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-danger">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {fileError}
              </p>
            )}

            {fileText && (
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={hasHeader}
                      onChange={(e) => setHasHeader(e.target.checked)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    First row is column names
                    <span className="text-xs font-normal text-muted-foreground">
                      (preset by a guess — please check: broker lists often have none)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    Delimiter
                    <select
                      value={delimiter}
                      onChange={(e) => setDelimiter(e.target.value as DelimiterChoice)}
                      className="h-9 rounded-xl border border-border bg-background/60 px-2.5 text-sm text-foreground focus-visible:border-primary/50 focus-visible:outline-none"
                    >
                      <option value="auto">Auto-detect</option>
                      <option value=",">Comma</option>
                      {/* JSX attribute strings don't process escapes — the
                          expression form is what makes this a real tab. */}
                      <option value={"\t"}>Tab</option>
                      <option value=";">Semicolon</option>
                    </select>
                  </label>
                </div>

                {/* First ~100 records, exactly as they'll be read */}
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-max text-left text-xs">
                    {hasHeader && previewGrid.length > 0 && (
                      <thead>
                        <tr className="border-b border-border bg-surface/60">
                          {previewGrid[0].map((h, i) => (
                            <th key={i} className="px-2.5 py-1.5 font-semibold">
                              {h || `Column ${i + 1}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {previewGrid.slice(hasHeader ? 1 : 0).map((row, r) => (
                        <tr key={r} className="border-b border-border/50 last:border-0">
                          {row.map((cell, c) => (
                            <td key={c} className="max-w-[220px] truncate px-2.5 py-1 text-muted-foreground">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <Button onClick={() => void toMapping()} disabled={inspecting} className="gap-2">
                    {inspecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    {inspecting ? "Reading columns…" : "Continue to mapping"}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <RecentJobs />
        </div>
      )}

      {step === "mapping" && inspect && (
        <MappingStep
          columns={inspect.columns}
          targets={targets}
          onTargetsChange={setTargets}
          aiMapped={inspect.source === "ai"}
          fields={fields}
          headerSig={columnHeaders.join("|").slice(0, 500)}
          plan={plan}
          footer={
            <StepFooter
              onBack={() => setStep("upload")}
              onNext={() => setStep("dedupe")}
              nextDisabled={!phoneMapped}
              nextHint={
                phoneMapped
                  ? undefined
                  : "Map a phone column first — a lead without a number can't be dialed."
              }
            />
          }
        />
      )}

      {step === "dedupe" && (
        <DedupeStep
          mode={dedupeMode}
          onModeChange={setDedupeMode}
          fileText={fileText}
          hasHeader={hasHeader}
          delimiter={delimiterParam}
          plan={plan}
          leadNounPlural={vocab.leadNounPlural}
          footer={
            <StepFooter
              onBack={() => setStep("mapping")}
              onNext={() => setStep("destination")}
            />
          }
        />
      )}

      {step === "destination" && (
        <DestinationStep
          groups={groups}
          campaigns={campaigns}
          dest={dest}
          onChange={setDest}
          leadNounPlural={vocab.leadNounPlural}
          footer={
            <StepFooter
              onBack={() => setStep("dedupe")}
              onNext={() => void startRun()}
              nextLabel="Start import"
            />
          }
        />
      )}

      {step === "run" && (
        <Card className="p-6">
          <h2 className="font-semibold tracking-tight">Importing {fileName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {runState.total > 1
              ? `Part ${Math.min(runState.sent + 1, runState.total)} of ${runState.total}`
              : "Uploading…"}
          </p>
          <div className="mt-4">
            <Progress
              value={
                runState.total > 0 ? (runState.sent / runState.total) * 100 : 8
              }
            />
          </div>
          {runState.error && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {runState.error}
            </p>
          )}
          <div className="mt-5 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={!runState.running}
              onClick={() => {
                cancelRef.current = true;
              }}
              className="gap-1.5"
            >
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {step === "report" && totals && (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold tracking-tight">
                {runState.error ? (
                  <AlertTriangle className="h-5 w-5 text-warning" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                )}
                {runState.error ? "Import stopped" : "Import complete"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {fileName} · {formatNumber(totals.fileRows)} data rows
              </p>
            </div>
          </div>

          {runState.error && (
            <p className="mt-3 text-sm text-danger">{runState.error}</p>
          )}
          {(() => {
            const shortfall = importShortfall(totals);
            return shortfall ? (
              <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {shortfall}
              </p>
            ) : null;
          })()}
          {totals.aiError && (
            <p className="mt-3 text-sm text-muted-foreground">{totals.aiError}</p>
          )}

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <ReportStat label="Created" value={totals.inserted} tone="success" />
            <ReportStat label="Updated" value={totals.updated} />
            <ReportStat label="Duplicates skipped" value={totals.duplicates} />
            <ReportStat label="Suppressed (DNC)" value={totals.dncSkipped + totals.dncFlagged} />
            <ReportStat label="No phone or name" value={totals.skippedRows} />
            <ReportStat label="Invalid phone" value={totals.invalidPhone} />
            <ReportStat label="Failed" value={totals.failed} tone={totals.failed ? "danger" : undefined} />
            <ReportStat label="Packs" value={totals.packs} />
          </dl>

          {rolledBack && (
            <p className="mt-4 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
              Rolled back: {formatNumber(rolledBack.removed)} removed,{" "}
              {formatNumber(rolledBack.kept)} kept because they'd already been worked.
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Link href="/leads" className={buttonVariants({ size: "sm", className: "gap-1.5" })}>
              View imported {vocab.leadNounPlural}
              <ArrowRight className="h-4 w-4" />
            </Link>
            {jobId && totals.failed > 0 && (
              <a
                href={`/api/leads/import/jobs/${jobId}/errors`}
                download
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Download error CSV
              </a>
            )}
            {jobId && !rolledBack && (
              <Button variant="outline" size="sm" onClick={() => void rollBack()} className="gap-1.5">
                <RotateCcw className="h-4 w-4" />
                Roll back
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep("upload");
                setFileText("");
                setFileName("");
                setTotals(null);
                setJobId(null);
                setRolledBack(null);
                setRunState({ running: false, sent: 0, total: 0, error: null });
              }}
            >
              Import another file
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function StepFooter({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
  nextHint,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextHint?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>
      <div className="flex items-center gap-3">
        {nextHint && <p className="text-xs text-muted-foreground">{nextHint}</p>}
        <Button size="sm" onClick={onNext} disabled={nextDisabled} className="gap-1.5">
          {nextLabel}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ReportStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "danger";
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-surface/50 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-1 text-xl font-bold",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {formatNumber(value)}
      </dd>
    </div>
  );
}
