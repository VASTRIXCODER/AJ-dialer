"use client";

import { BookmarkPlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { LeadFieldDef, LeadFieldType } from "@/lib/leads/field-schema";
import type { ColumnPlan } from "@/lib/leads/parse-request";
import { cn } from "@/lib/utils";
import {
  coreTargetOptions,
  targetsFromPlan,
  type ColumnTarget,
  type InspectedColumn,
} from "./plan";
import { SelectMenu } from "@/components/ui/select-menu";

// ─────────────────────────────────────────────────────────────────────────────
// Mapping step: one card per column — its header, real sample values, and a
// target select. The proposals come from the same head-to-head parse the
// import runs (an "AI suggested" badge marks where the model chose), and every
// one of them is correctable before a single row is written. Mapping templates
// let a team map a recurring broker export once.
// ─────────────────────────────────────────────────────────────────────────────

const CUSTOM_TYPES: { value: LeadFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "boolean", label: "Yes / no" },
  { value: "date", label: "Date" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
];

interface Template {
  id: string;
  name: string;
  headerSig: string;
  plan: unknown;
}

export function MappingStep({
  columns,
  targets,
  onTargetsChange,
  aiMapped,
  fields,
  headerSig,
  plan,
  footer,
}: {
  columns: InspectedColumn[];
  targets: ColumnTarget[];
  onTargetsChange: (t: ColumnTarget[]) => void;
  /** True when the AI mapping won the head-to-head for this file. */
  aiMapped: boolean;
  fields: LeadFieldDef[];
  headerSig: string;
  /** The current plan (for saving as a template). */
  plan: ColumnPlan;
  footer: ReactNode;
}) {
  const { toast } = useToast();
  const options = coreTargetOptions(fields);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [savingName, setSavingName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/leads/import/templates")
      .then((r) => r.json())
      .then((json) => {
        if (alive && Array.isArray(json.templates)) setTemplates(json.templates);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setTemplatesLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function setTarget(index: number, next: ColumnTarget) {
    const copy = targets.slice();
    copy[index] = next;
    onTargetsChange(copy);
  }

  /** The select's flat value encoding — core fields plus the special targets. */
  function valueOf(t: ColumnTarget): string {
    if (t.kind === "core") return `core:${t.field}`;
    return t.kind;
  }

  function onSelect(index: number, value: string) {
    const header = columns[index]?.header ?? `Column ${index + 1}`;
    if (value.startsWith("core:")) {
      // One column per core field: claiming a field releases it elsewhere.
      const field = value.slice(5) as Extract<ColumnTarget, { kind: "core" }>["field"];
      const copy = targets.map((t, i): ColumnTarget => {
        if (i === index) return { kind: "core", field };
        if (t.kind === "core" && t.field === field) return { kind: "ignore" };
        return t;
      });
      onTargetsChange(copy);
      return;
    }
    if (value === "custom") {
      setTarget(index, { kind: "custom", label: header, type: "text" });
    } else if (value === "dnc") {
      setTarget(index, { kind: "dnc" });
    } else if (value === "dialPref") {
      setTarget(index, { kind: "dialPref" });
    } else {
      setTarget(index, { kind: "ignore" });
    }
  }

  async function saveTemplate() {
    const name = savingName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await fetch("/api/leads/import/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, headerSig, plan }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't save template", description: String(json.error ?? ""), tone: "danger" });
        return;
      }
      setTemplates((t) => [{ id: String(json.id), name, headerSig, plan }, ...t]);
      setSavingName("");
      toast({ title: "Mapping template saved", tone: "success" });
    } finally {
      setSaving(false);
    }
  }

  function applyTemplate(t: Template) {
    const applied = targetsFromPlan(t.plan as ColumnPlan, columns.length);
    if (!applied) {
      toast({ title: "That template can't be applied here", tone: "danger" });
      return;
    }
    onTargetsChange(applied);
    toast({ title: `Applied "${t.name}"`, tone: "success" });
  }

  async function deleteTemplate(id: string) {
    setTemplates((t) => t.filter((x) => x.id !== id));
    await fetch(`/api/leads/import/templates?id=${id}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold tracking-tight">Map your columns</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Confirm what each column is. Nothing imports until you say so.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              placeholder="Save mapping as…"
              className="h-9 w-44"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void saveTemplate()}
              disabled={!savingName.trim() || saving}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookmarkPlus className="h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </div>

        {templatesLoaded && templates.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Templates
            </span>
            {templates.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs font-medium"
              >
                <button
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="hover:text-primary"
                  title={
                    t.headerSig && t.headerSig === headerSig
                      ? "Saved from a file with these exact columns"
                      : "Apply this saved mapping"
                  }
                >
                  {t.name}
                  {t.headerSig && t.headerSig === headerSig ? " ✓" : ""}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteTemplate(t.id)}
                  aria-label={`Delete template ${t.name}`}
                  className="text-muted-foreground hover:text-danger"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((col) => {
          const target = targets[col.index] ?? { kind: "ignore" as const };
          const proposed = col.proposal.kind !== "ignore";
          return (
            <Card key={col.index} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold" title={col.header}>
                  {col.header}
                </p>
                {proposed && aiMapped && (
                  <Badge tone="accent" className="shrink-0 gap-1">
                    <Sparkles className="h-3 w-3" />
                    AI suggested
                  </Badge>
                )}
                {proposed && !aiMapped && col.confidence === "high" && (
                  <Badge tone="primary" className="shrink-0">
                    Matched
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 min-h-[2.25rem] space-y-0.5">
                {col.samples.length ? (
                  col.samples.slice(0, 3).map((s, i) => (
                    <p key={i} className="truncate text-xs text-muted-foreground" title={s}>
                      {s}
                    </p>
                  ))
                ) : (
                  <p className="text-xs italic text-ink-3">No values</p>
                )}
              </div>
              {/* SelectMenu has no optgroup; the group name rides along as
                  each option's hint, on its own line under the label. */}
              <SelectMenu
                label={`Target for column ${col.header}`}
                size="sm"
                className="mt-2 w-full"
                triggerClassName={cn(
                  "h-9 w-full",
                  target.kind === "ignore"
                    ? "border-border text-muted-foreground"
                    : "border-primary/40",
                )}
                value={valueOf(target)}
                onChange={(v) => onSelect(col.index, v)}
                options={[
                  { value: "ignore", label: "Ignore this column" },
                  ...options.map((o) => ({
                    value: `core:${o.field}`,
                    label: o.label,
                    hint: "Lead field",
                  })),
                  { value: "custom", label: "New custom field…", hint: "Special" },
                  { value: "dnc", label: "Do-Not-Call flag", hint: "Special" },
                  { value: "dialPref", label: "Dialing preference", hint: "Special" },
                ]}
              />
              {target.kind === "custom" && (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={target.label}
                    onChange={(e) =>
                      setTarget(col.index, { ...target, label: e.target.value })
                    }
                    placeholder="Field name"
                    className="h-8 flex-1 text-xs"
                  />
                  <SelectMenu
                    label="Custom field type"
                    size="sm"
                    triggerClassName="h-8"
                    value={target.type}
                    onChange={(v) =>
                      setTarget(col.index, { ...target, type: v as LeadFieldType })
                    }
                    options={CUSTOM_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  />
                </div>
              )}
              {target.kind === "dnc" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Rows marked here import suppressed — stored, reported, never dialed.
                </p>
              )}
              {target.kind === "dialPref" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Values like ai / manual / either / none control who may dial each row.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {footer}
    </div>
  );
}
