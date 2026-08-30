"use client";

import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Download,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input, Label } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  ACTIVITY_EXPORT_KEYS,
  CORE_EXPORT_KEYS,
  DEFAULT_EXPORT_COLUMNS,
  DEFAULT_EXPORT_FORMAT,
  EXPORT_COLUMN_LABELS,
  EXPORT_MAX_COLUMNS,
  EXPORT_MAX_HEADER_CHARS,
  EXPORT_MAX_TEMPLATES,
  EXPORT_MAX_TEMPLATE_NAME,
  type ExportColumn,
  type ExportColumnKey,
  type ExportFormat,
  type ExportTemplate,
  type StandardExportKey,
} from "@/lib/leads/export-spec";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import type { FilterSpec } from "@/lib/leads/filter-spec";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Export v2 dialog — pick columns (org-schema labels, renameable headers, ↑↓
// order), pick a format, preview the row count for the CURRENT filter, save
// the whole setup as a reusable template (org settings `exportTemplates`), and
// stream the download with progress. The POST body is an ExportSpec; the
// server re-sanitizes it, so everything here is UX, not a boundary.
// ─────────────────────────────────────────────────────────────────────────────

/** Standard export key → the camelCase core-slot key the org schema relabels. */
const CORE_SLOT_KEYS: Partial<Record<StandardExportKey, string>> = {
  utility_provider: "utilityProvider",
  solar_provider: "solarProvider",
  utility_bill: "utilityBill",
  solar_payment: "solarPayment",
  has_ev: "hasEV",
  has_pool: "hasPool",
  has_battery: "hasBattery",
  multiple_systems: "multipleSystems",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type CountState =
  | { status: "idle" | "loading" | "error" }
  | { status: "done"; n: number };

export function ExportDialog({
  filterSpec,
  fields,
  templates: initialTemplates,
  canSaveTemplates,
}: {
  /** The SANITIZED spec behind the current ?f= — null = the whole scope. */
  filterSpec: FilterSpec | null;
  /** The org's resolved lead-field schema (labels + the custom defs). */
  fields: LeadFieldDef[];
  /** Saved setups from org settings (already sanitized by mergeSettings). */
  templates: ExportTemplate[];
  /** Saving/deleting templates PATCHes org settings — needs `org.edit`. */
  canSaveTemplates: boolean;
}) {
  const vocab = useVocabulary();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<ExportColumn[]>(() =>
    DEFAULT_EXPORT_COLUMNS.map((c) => ({ ...c })),
  );
  const [format, setFormat] = useState<ExportFormat>({ ...DEFAULT_EXPORT_FORMAT });
  const [timezone, setTimezone] = useState("");
  const [templates, setTemplates] = useState<ExportTemplate[]>(initialTemplates);
  const [tplName, setTplName] = useState("");
  const [tplBusy, setTplBusy] = useState(false);
  const [countState, setCountState] = useState<CountState>({ status: "idle" });
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");

  const customDefs = useMemo(() => fields.filter((d) => d.source === "custom"), [fields]);
  const customKeys = useMemo(() => new Set(customDefs.map((d) => d.key)), [customDefs]);

  // Every choosable key's display label: standard keys through the org's
  // resolved schema (a relabeled core slot exports under the org's own words),
  // custom keys by their def's label — never a hardcoded industry noun.
  const labelFor = useMemo(() => {
    const coreByKey = new Map(fields.filter((d) => d.source === "core").map((d) => [d.key, d.label]));
    return (key: ExportColumnKey): string => {
      if (key.startsWith("custom:")) {
        const k = key.slice("custom:".length);
        return customDefs.find((d) => d.key === k)?.label ?? k;
      }
      const slot = CORE_SLOT_KEYS[key as StandardExportKey];
      if (slot) {
        const fromSchema = coreByKey.get(slot);
        if (fromSchema) return fromSchema;
      }
      return EXPORT_COLUMN_LABELS[key as StandardExportKey];
    };
  }, [fields, customDefs]);

  const selectedKeys = useMemo(() => new Set(columns.map((c) => c.key)), [columns]);

  // Live "Exporting N rows" for the current filter. No filter = the whole
  // scope; the count endpoint requires a non-empty spec, so we skip it and say
  // so in words instead of faking a number.
  useEffect(() => {
    if (!open || !filterSpec) return;
    let cancelled = false;
    setCountState({ status: "loading" });
    fetch("/api/leads/filter/count", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filter: filterSpec }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const j = (await res.json()) as { count?: number };
        if (!cancelled) setCountState({ status: "done", n: Number(j.count ?? 0) });
      })
      .catch(() => {
        if (!cancelled) setCountState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, filterSpec]);

  function toggle(key: ExportColumnKey) {
    setColumns((prev) => {
      if (prev.some((c) => c.key === key)) return prev.filter((c) => c.key !== key);
      if (prev.length >= EXPORT_MAX_COLUMNS) return prev;
      return [...prev, { key, header: labelFor(key) }];
    });
  }

  function move(index: number, delta: -1 | 1) {
    setColumns((prev) => {
      const next = [...prev];
      const j = index + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function applyTemplate(t: ExportTemplate) {
    // A template can reference a custom field deleted since it was saved —
    // degrade to the surviving columns rather than exporting a ghost.
    const usable = t.columns.filter(
      (c) => !c.key.startsWith("custom:") || customKeys.has(c.key.slice("custom:".length)),
    );
    setColumns(usable.map((c) => ({ ...c })));
    setFormat({ ...t.format });
    setTimezone(t.format.timezone ?? "");
    if (usable.length < t.columns.length) {
      toast({
        title: "Template applied with gaps",
        description: `${t.columns.length - usable.length} column(s) reference fields that no longer exist and were skipped.`,
      });
    }
  }

  async function persistTemplates(next: ExportTemplate[]): Promise<boolean> {
    const res = await fetch("/api/org/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { exportTemplates: next } }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !j.ok) {
      toast({
        title: "Couldn't save templates",
        description: j.error ?? "Saving needs organization-settings access.",
        tone: "danger",
      });
      return false;
    }
    setTemplates(next);
    return true;
  }

  async function saveTemplate() {
    const name = tplName.trim().slice(0, EXPORT_MAX_TEMPLATE_NAME);
    if (!name || columns.length === 0 || templates.length >= EXPORT_MAX_TEMPLATES) return;
    setTplBusy(true);
    try {
      const t: ExportTemplate = {
        id: crypto.randomUUID(),
        name,
        columns: columns.map((c) => ({ ...c })),
        format: effectiveFormat(),
      };
      if (await persistTemplates([...templates, t])) {
        setTplName("");
        toast({ title: "Template saved", description: name, tone: "success" });
      }
    } finally {
      setTplBusy(false);
    }
  }

  async function deleteTemplate(t: ExportTemplate) {
    const ok = await confirm({
      title: `Delete "${t.name}"?`,
      body: "This removes the saved export setup for everyone in the workspace.",
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setTplBusy(true);
    try {
      await persistTemplates(templates.filter((x) => x.id !== t.id));
    } finally {
      setTplBusy(false);
    }
  }

  function effectiveFormat(): ExportFormat {
    const tz = timezone.trim();
    const base: ExportFormat = {
      delimiter: format.delimiter,
      dateFormat: format.dateFormat,
      nullAs: format.nullAs,
      bom: format.bom,
    };
    return tz ? { ...base, timezone: tz } : base;
  }

  async function runExport() {
    setExporting(true);
    setErr("");
    setProgress(0);
    try {
      const res = await fetch("/api/leads/export/v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter: filterSpec, columns, format: effectiveFormat() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `Export failed (${res.status}).`);
        return;
      }
      // Stream the body so a big file shows progress instead of a frozen button.
      const chunks: BlobPart[] = [];
      let bytes = 0;
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            bytes += value.byteLength;
            setProgress(bytes);
          }
        }
      } else {
        const buf = await res.arrayBuffer();
        chunks.push(buf);
        bytes = buf.byteLength;
      }
      const blob = new Blob(chunks, { type: "text/csv;charset=utf-8" });
      const cd = res.headers.get("content-disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? "export.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast({
        title: "Export ready",
        description: `${name} · ${formatBytes(bytes)}`,
        tone: "success",
      });
      setOpen(false);
    } catch {
      setErr("Network error during export — nothing was downloaded.");
    } finally {
      setExporting(false);
    }
  }

  const groups: { title: string; keys: ExportColumnKey[] }[] = useMemo(
    () => [
      { title: "Standard", keys: [...CORE_EXPORT_KEYS] },
      ...(customDefs.length
        ? [
            {
              title: "Custom fields",
              keys: customDefs.map((d) => `custom:${d.key}` as ExportColumnKey),
            },
          ]
        : []),
      { title: "Activity", keys: [...ACTIVITY_EXPORT_KEYS] },
    ],
    [customDefs],
  );

  const scopeLine = filterSpec ? (
    countState.status === "done" ? (
      <>
        Exporting <span className="font-semibold text-foreground tabular">{countState.n.toLocaleString()}</span>{" "}
        {countState.n === 1 ? vocab.leadNoun : vocab.leadNounPlural} — the current filter.
      </>
    ) : countState.status === "error" ? (
      <>Exporting the current filter&apos;s matches (count unavailable).</>
    ) : (
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Counting matches for the current filter…
      </span>
    )
  ) : (
    <>
      No filter is active — this exports{" "}
      <span className="font-medium text-foreground">everything in your scope</span>.
    </>
  );

  return (
    <>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Download className="h-4 w-4" />
        Export
      </Button>

      {open && (
        <Modal
          onClose={() => setOpen(false)}
          labelledBy="export-dialog-title"
          maxWidth="max-w-3xl"
          dismissible={!exporting}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
            <div>
              <p id="export-dialog-title" className="text-base font-semibold leading-tight">
                Export {vocab.LeadNounPlural}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{scopeLine}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-5 overflow-y-auto p-5">
            {/* ── Field chooser + selected order ─────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Fields</Label>
                <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-border bg-background/40 p-3">
                  {groups.map((g) => (
                    <div key={g.title}>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {g.title}
                      </p>
                      <div className="grid grid-cols-1 gap-1">
                        {g.keys.map((key) => (
                          <label
                            key={key}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition-colors hover:bg-muted"
                          >
                            <input
                              type="checkbox"
                              className="h-[22px] w-[22px] rounded border-border"
                              checked={selectedKeys.has(key)}
                              onChange={() => toggle(key)}
                            />
                            <span className="truncate">{labelFor(key)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>
                  Columns &amp; headers{" "}
                  <span className="normal-case tracking-normal text-ink-3 tabular">
                    ({columns.length}/{EXPORT_MAX_COLUMNS})
                  </span>
                </Label>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border bg-background/40 p-2">
                  {columns.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                      No columns selected — tick fields on the left.
                    </p>
                  ) : (
                    columns.map((c, i) => (
                      <div key={c.key} className="flex items-center gap-1.5">
                        <Input
                          value={c.header}
                          maxLength={EXPORT_MAX_HEADER_CHARS}
                          aria-label={`Header for ${labelFor(c.key)}`}
                          className="h-8 flex-1 px-2.5 py-1 text-xs"
                          onChange={(e) =>
                            setColumns((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)),
                            )
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Move ${labelFor(c.key)} up`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${labelFor(c.key)} down`}
                          disabled={i === columns.length - 1}
                          onClick={() => move(i, 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${labelFor(c.key)}`}
                          onClick={() => toggle(c.key)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-danger"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* ── Format options ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label>Delimiter</Label>
                <SelectMenu
                  label="Delimiter"
                  className="w-full"
                  triggerClassName="w-full"
                  value={format.delimiter === "\t" ? "tab" : format.delimiter}
                  onChange={(v) =>
                    setFormat((f) => ({
                      ...f,
                      delimiter: v === "tab" ? "\t" : (v as "," | ";"),
                    }))
                  }
                  options={[
                    { value: ",", label: "Comma (,)" },
                    { value: ";", label: "Semicolon (;)" },
                    { value: "tab", label: "Tab" },
                  ]}
                />
              </div>
              <div>
                <Label>Dates</Label>
                <SelectMenu
                  label="Dates"
                  className="w-full"
                  triggerClassName="w-full"
                  value={format.dateFormat}
                  onChange={(v) => setFormat((f) => ({ ...f, dateFormat: v as "iso" | "us" }))}
                  options={[
                    { value: "iso", label: "ISO (2026-08-28)" },
                    { value: "us", label: "US (08/28/2026)" },
                  ]}
                />
              </div>
              <div>
                <Label>Empty cells</Label>
                <SelectMenu
                  label="Empty cells"
                  className="w-full"
                  triggerClassName="w-full"
                  value={format.nullAs === "—" ? "dash" : "blank"}
                  onChange={(v) => setFormat((f) => ({ ...f, nullAs: v === "dash" ? "—" : "" }))}
                  options={[
                    { value: "blank", label: "Blank" },
                    { value: "dash", label: "— (em dash)" },
                  ]}
                />
              </div>
              <div>
                <Label>Timezone</Label>
                <Input
                  value={timezone}
                  placeholder="UTC"
                  aria-label="Timezone for dates (IANA name)"
                  onChange={(e) => setTimezone(e.target.value)}
                />
              </div>
            </div>
            <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-[22px] w-[22px] rounded border-border"
                checked={format.bom}
                onChange={(e) => setFormat((f) => ({ ...f, bom: e.target.checked }))}
              />
              Excel-friendly encoding (UTF-8 BOM)
            </label>

            {/* ── Saved templates ────────────────────────────────────────── */}
            <div>
              <Label>Saved templates</Label>
              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None yet{canSaveTemplates ? " — save the current setup below." : "."}
                </p>
              ) : (
                <div className="space-y-1">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 rounded-xl border border-border bg-background/40 px-3 py-2"
                    >
                      <Bookmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                      <span className="text-xs text-muted-foreground tabular">
                        {t.columns.length} col
                      </span>
                      <Button variant="outline" size="sm" onClick={() => applyTemplate(t)}>
                        Apply
                      </Button>
                      {canSaveTemplates && (
                        <button
                          type="button"
                          aria-label={`Delete template ${t.name}`}
                          disabled={tplBusy}
                          onClick={() => void deleteTemplate(t)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {canSaveTemplates && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={tplName}
                    maxLength={EXPORT_MAX_TEMPLATE_NAME}
                    placeholder="Template name"
                    aria-label="New template name"
                    onChange={(e) => setTplName(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      tplBusy ||
                      !tplName.trim() ||
                      columns.length === 0 ||
                      templates.length >= EXPORT_MAX_TEMPLATES
                    }
                    onClick={() => void saveTemplate()}
                    className="gap-1.5"
                  >
                    {tplBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save setup
                  </Button>
                </div>
              )}
              {templates.length >= EXPORT_MAX_TEMPLATES && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Template limit reached ({EXPORT_MAX_TEMPLATES}) — delete one to save another.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 p-5">
            {err && (
              <p role="alert" className="w-full text-sm font-medium text-danger">
                {err}
              </p>
            )}
            <a
              href="/api/leads/export"
              download
              className="mr-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              title="The fixed-column CSV that re-imports cleanly"
            >
              Legacy re-import format
            </a>
            <span
              className={cn(
                "text-xs text-muted-foreground tabular",
                !exporting && "invisible",
              )}
              aria-hidden={!exporting}
            >
              {formatBytes(progress)} received…
            </span>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={exporting}>
              Cancel
            </Button>
            <Button
              className="gap-2"
              onClick={() => void runExport()}
              disabled={exporting || columns.length === 0}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export CSV
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
