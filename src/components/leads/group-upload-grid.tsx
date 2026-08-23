"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Inbox,
  Loader2,
  Settings2,
  Sparkles,
  UploadCloud,
  Wrench,
} from "lucide-react";
import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import type { LeadGroupWithCount } from "@/lib/db/lead-groups";
import { cn } from "@/lib/utils";
import { CampaignCertificationDialog } from "./campaign-certification-dialog";
import { LeadGroupManager } from "./lead-group-manager";
import { SortPreviewReview, type SortPreviewResponse } from "./sort-preview-review";
import { useCsvUpload } from "./use-csv-upload";

/** Pack-size presets offered under the AI tile. 0 = don't split into packs. */
const PACK_PRESETS = [0, 50, 100, 250, 500];
/** How many rows to hand the classifier. 0 = sort the whole file. */
const SORT_PRESETS = [500, 1000, 2000, 5000, 0];

function UploadTile({
  groupKey,
  label,
  hint,
  manual,
  packSize,
  packBy,
  packBatchFor,
}: {
  groupKey: string | null;
  label: string;
  hint: string;
  manual?: boolean;
  packSize: number;
  packBy: "sequence" | "city";
  packBatchFor: (file: string) => string;
}) {
  const [batch, setBatch] = useState("Upload");
  const { status, handleFile, certPrompt, certifyAndRetry, cancelCert } = useCsvUpload({
    leadGroup: groupKey,
    packSize,
    packBatch: batch,
    packBy,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function onFile(f: File) {
    setBatch(packBatchFor(f.name));
    handleFile(f);
  }

  return (
    <div>
      {certPrompt && (
        <CampaignCertificationDialog
          campaignId={certPrompt.campaignId}
          onCertified={certifyAndRetry}
          onCancel={cancelCert}
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
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
          if (f) onFile(f);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-5 text-center transition-colors disabled:opacity-60",
          dragOver
            ? "border-primary bg-primary-soft/40"
            : "border-border bg-muted/30 hover:border-primary/40 hover:bg-primary-soft/30",
        )}
      >
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-glow",
            groupKey === null ? "bg-warning" : manual ? "bg-muted-foreground" : "bg-brand",
          )}
        >
          {status.type === "working" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : groupKey === null ? (
            <Inbox className="h-5 w-5" />
          ) : manual ? (
            <Wrench className="h-5 w-5" />
          ) : (
            <UploadCloud className="h-5 w-5" />
          )}
        </div>
        <p className="mt-1 text-sm font-semibold">{label}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{hint}</p>
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
 * Dump one CSV and let Claude sort it into the org's own groups. Nothing is
 * inserted here — a successful sort hands the proposal to the review screen.
 * `sortLimit` bounds how many rows the model actually sees; the rest come back
 * in Miscellaneous and can be sorted later from the Leads screen.
 */
function AutoSortTile({
  sortLimit,
  onPreview,
}: {
  sortLimit: number;
  onPreview: (p: SortPreviewResponse, fileName: string) => void;
}) {
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
      setStatus({ type: "working", message: "Sorting into your groups…" });
      const res = await fetch("/api/leads/sort-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: text, sortLimit }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        setStatus({ type: "error", message: json.error ?? "Couldn't sort that file." });
        return;
      }
      setStatus({ type: "idle" });
      onPreview(json as SortPreviewResponse, file.name.replace(/\.csv$/i, ""));
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
        <p className="mt-1 text-sm font-semibold">Sort with AI</p>
        <p className="text-xs text-muted-foreground">
          {sortLimit > 0 ? `Sorts the first ${sortLimit.toLocaleString()}` : "Sorts everything"}
        </p>
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

function OptionRow({
  title,
  hint,
  options,
  value,
  onChange,
  format,
}: {
  title: string;
  hint: string;
  options: number[];
  value: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
              value === n
                ? "bg-primary text-white"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {format(n)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Lead intake. One dropzone per group the ORG defined (each stamping its rows
 * with that group — no AI involved, the group is explicit by construction), a
 * Miscellaneous dropzone for anything that doesn't belong to one yet, and an
 * "Sort with AI" dropzone that hands off to the review screen.
 *
 * The two controls above the grid are what make a 10,000-row file manageable:
 * how many rows to spend AI on, and how big a pack to cut the import into.
 */
export function GroupUploadGrid({
  canImport,
  groups,
  miscCount,
  missingCountyCount,
}: {
  canImport: boolean;
  groups: LeadGroupWithCount[];
  miscCount: number;
  /** Leads with a ZIP but no county yet — passed straight through to the
   *  "Backfill counties" control in Edit groups (see LeadGroupManager). */
  missingCountyCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [preview, setPreview] = useState<{ data: SortPreviewResponse; file: string } | null>(null);
  const [sortLimit, setSortLimit] = useState(2000);
  const [packSize, setPackSize] = useState(0);
  const [packBy, setPackBy] = useState<"sequence" | "city">("sequence");

  if (!canImport) return null;

  if (preview) {
    return (
      <SortPreviewReview
        preview={preview.data}
        packSize={packSize}
        packBatch={preview.file}
        packBy={packBy}
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
        <div className="border-t border-border">
          <div className="flex flex-wrap items-start justify-between gap-6 border-b border-border bg-surface/40 p-5">
            <OptionRow
              title="How many to sort with AI"
              hint="The rest import as Miscellaneous — sort them later."
              options={SORT_PRESETS}
              value={sortLimit}
              onChange={setSortLimit}
              format={(n) => (n === 0 ? "All" : n.toLocaleString())}
            />
            <OptionRow
              title="Split into packs of"
              hint="Deal a big list out a pack at a time."
              options={PACK_PRESETS}
              value={packSize}
              onChange={setPackSize}
              format={(n) => (n === 0 ? "No packs" : String(n))}
            />
            {/* Only meaningful once packs are on — hidden otherwise rather than
                shown disabled, so the row doesn't advertise a dead control. */}
            {packSize > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Group packs by
                </p>
                <p className="mb-2 text-xs text-muted-foreground">
                  Either way, rows keep the order of your file.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { v: "sequence", label: "File order" },
                      { v: "city", label: "City" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setPackBy(o.v)}
                      title={
                        o.v === "city"
                          ? "Each city gets its own pack, in the order your file introduces them"
                          : "Straight slices down the file, in order"
                      }
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                        packBy === o.v
                          ? "bg-primary text-white"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setManaging((m) => !m)}
              className="flex h-9 items-center gap-1.5 self-end rounded-xl border border-border bg-background/60 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              <Settings2 className="h-4 w-4" />
              {managing ? "Done editing groups" : "Edit groups"}
            </button>
          </div>

          {managing ? (
            <div className="p-5">
              <LeadGroupManager
                initialGroups={groups}
                initialMiscCount={miscCount}
                initialMissingCountyCount={missingCountyCount}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-6">
              {groups.map((g) => (
                <UploadTile
                  key={g.key}
                  groupKey={g.key}
                  label={g.label}
                  hint={g.description || `${g.leadCount.toLocaleString()} leads`}
                  manual={g.kind === "manual"}
                  packSize={packSize}
                  packBy={packBy}
                  packBatchFor={(f) => f.replace(/\.csv$/i, "")}
                />
              ))}
              <UploadTile
                groupKey={null}
                label="Miscellaneous"
                hint="Unsorted — file them later"
                packSize={packSize}
                packBy={packBy}
                packBatchFor={(f) => f.replace(/\.csv$/i, "")}
              />
              <AutoSortTile
                sortLimit={sortLimit}
                onPreview={(data, file) => setPreview({ data, file })}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
