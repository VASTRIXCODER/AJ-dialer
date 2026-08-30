"use client";

import * as React from "react";
import { ListFilter, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import type {
  FilterCmp,
  FilterCondition,
  FilterGroup,
  FilterSpec,
  FilterValue,
} from "@/lib/leads/filter-spec";
import { cn } from "@/lib/utils";
import {
  buildFieldCatalog,
  CMP_LABELS,
  cmpsFor,
  defaultCondition,
  defaultValue,
  DIALING_PREFERENCE_OPTIONS,
  FIELD_GROUP_LABELS,
  fieldOptionFor,
  VALUELESS_CMPS,
  type FieldGroup,
  type FieldOption,
} from "./fields";
import { LiveCount } from "./live-count";

// ─────────────────────────────────────────────────────────────────────────────
// FilterBuilder — the visual editor for a FilterSpec.
//
// CONTROLLED and value-shaped: it renders `value`, emits a fresh spec through
// `onChange` on every edit (null when the last condition goes), and holds no
// spec state of its own — the page owns persistence (URL param, saved view).
//
// The emitted spec is RAW, not pre-sanitized: a number input mid-typing has no
// value yet, and sanitizing here would make the row vanish under the user's
// cursor. The server sanitizes at the boundary (the count route and every
// consumer of the spec), which is the only sanitization that counts anyway.
//
// Field labels come from the org's resolved schema via the `fields` prop —
// nothing industry-specific is hardcoded here (see fields.ts).
// ─────────────────────────────────────────────────────────────────────────────

// Mirror of sanitizeFilterSpec's caps (module-private there, so restated):
// beyond these the sanitizer silently DROPS — the UI must stop first.
const MAX_GROUPS = 8;
const MAX_CONDITIONS = 8;

export interface FilterBuilderProps {
  value: FilterSpec | null;
  onChange: (next: FilterSpec | null) => void;
  /** The org's resolved lead schema — core slot labels + custom fields. */
  fields: LeadFieldDef[];
  statusOptions: { value: string; label: string }[];
  campaignOptions: { id: string; name: string }[];
  repOptions: { id: string; name: string }[];
  className?: string;
}

/** Two-state AND/OR segmented toggle. */
function OpToggle({
  value,
  onChange,
  labels,
  ariaLabel,
}: {
  value: "and" | "or";
  onChange: (v: "and" | "or") => void;
  labels: [string, string];
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 rounded-lg border border-border/70 bg-surface p-0.5 text-xs font-semibold"
    >
      {(["and", "or"] as const).map((op, i) => (
        <button
          key={op}
          type="button"
          aria-pressed={value === op}
          onClick={() => onChange(op)}
          className={cn(
            "rounded-md px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === op
              ? "bg-primary-soft text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  );
}

/** What KIND of value a (family, cmp) pair takes — drives input preservation
 *  when the operator changes (a number survives eq→gte; it doesn't survive
 *  eq→between). */
type ValueShape = "none" | "string" | "number" | "range" | "days" | "date";

function shapeOf(field: FieldOption, cmp: FilterCmp): ValueShape {
  if (VALUELESS_CMPS.has(cmp)) return "none";
  if (cmp === "between") return "range";
  if (cmp === "within_days" || cmp === "older_than_days") return "days";
  if (cmp === "before" || cmp === "after") return "date";
  if (field.family === "number") return "number";
  return "string";
}

function ConditionValue({
  field,
  cond,
  onValue,
  statusOptions,
  campaignOptions,
  repOptions,
}: {
  field: FieldOption;
  cond: FilterCondition;
  onValue: (v: FilterValue | undefined) => void;
  statusOptions: { value: string; label: string }[];
  campaignOptions: { id: string; name: string }[];
  repOptions: { id: string; name: string }[];
}) {
  const shape = shapeOf(field, cond.cmp);
  if (shape === "none") return null;

  const numeric = (raw: string): number | undefined => {
    if (raw.trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  if (shape === "range") {
    const [lo, hi] = Array.isArray(cond.value) && cond.value.length === 2
      ? (cond.value as [number, number])
      : [undefined, undefined];
    const set = (which: 0 | 1, raw: string) => {
      const n = numeric(raw);
      const next: [number, number] = [Number(lo ?? 0), Number(hi ?? 0)];
      if (n === undefined) return onValue(undefined); // mid-typing: let the server drop it
      next[which] = n;
      onValue(next);
    };
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <Input
          type="number"
          aria-label="From"
          className="h-9 min-w-[5rem] flex-1 py-1.5"
          value={lo ?? ""}
          onChange={(e) => set(0, e.target.value)}
        />
        <span className="text-xs text-muted-foreground">and</span>
        <Input
          type="number"
          aria-label="To"
          className="h-9 min-w-[5rem] flex-1 py-1.5"
          value={hi ?? ""}
          onChange={(e) => set(1, e.target.value)}
        />
      </span>
    );
  }

  if (shape === "days" || shape === "number") {
    return (
      <Input
        type="number"
        min={shape === "days" ? 0 : undefined}
        aria-label={shape === "days" ? "Days" : "Value"}
        className="h-9 min-w-[6rem] flex-1 py-1.5"
        value={typeof cond.value === "number" ? cond.value : ""}
        onChange={(e) => onValue(numeric(e.target.value))}
      />
    );
  }

  if (shape === "date") {
    return (
      <Input
        type="date"
        aria-label="Date"
        className="h-9 min-w-[9rem] flex-1 py-1.5"
        value={typeof cond.value === "string" ? cond.value : ""}
        onChange={(e) => onValue(e.target.value || undefined)}
      />
    );
  }

  // String shape: dedicated selects where the value is a stored key.
  const str = typeof cond.value === "string" ? cond.value : "";
  if (cond.cmp === "eq" || cond.cmp === "neq") {
    const selectFor = (options: { value: string; label: string }[], name: string) => (
      <Select
        aria-label={name}
        className="h-9 min-w-[9rem] flex-1 py-1.5"
        value={str}
        onChange={(e) => onValue(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
    if (field.input === "status") return selectFor(statusOptions, "Status value");
    if (field.input === "campaign")
      return selectFor(
        campaignOptions.map((c) => ({ value: c.id, label: c.name })),
        "Campaign value",
      );
    if (field.input === "rep")
      return selectFor(
        repOptions.map((r) => ({ value: r.id, label: r.name })),
        "Rep value",
      );
    if (field.input === "dialpref")
      return selectFor(DIALING_PREFERENCE_OPTIONS, "Dialing preference value");
  }

  return (
    <Input
      type="text"
      aria-label="Value"
      placeholder={field.kind === "derived" && field.key === "latest_outcome" ? "Outcome key (e.g. no_answer)" : "Value…"}
      className="h-9 min-w-[9rem] flex-1 py-1.5"
      value={str}
      onChange={(e) => onValue(e.target.value)}
    />
  );
}

export function FilterBuilder({
  value,
  onChange,
  fields,
  statusOptions,
  campaignOptions,
  repOptions,
  className,
}: FilterBuilderProps) {
  const catalog = React.useMemo(() => buildFieldCatalog(fields), [fields]);
  const optionCtx = React.useMemo(
    () => ({ statusOptions, campaignOptions, repOptions }),
    [statusOptions, campaignOptions, repOptions],
  );
  const grouped = React.useMemo(() => {
    const by = new Map<FieldGroup, FieldOption[]>();
    for (const f of catalog) {
      const list = by.get(f.group) ?? [];
      list.push(f);
      by.set(f.group, list);
    }
    return by;
  }, [catalog]);

  const spec: FilterSpec = value ?? { op: "and", groups: [] };

  const emit = (groups: FilterGroup[], op = spec.op) => {
    const kept = groups.filter((g) => g.conditions.length > 0);
    onChange(kept.length === 0 ? null : { op, groups: kept });
  };

  const setGroup = (gi: number, next: FilterGroup) =>
    emit(spec.groups.map((g, i) => (i === gi ? next : g)));

  const setCondition = (gi: number, ci: number, next: FilterCondition) =>
    setGroup(gi, {
      ...spec.groups[gi],
      conditions: spec.groups[gi].conditions.map((c, i) => (i === ci ? next : c)),
    });

  const removeCondition = (gi: number, ci: number) =>
    setGroup(gi, {
      ...spec.groups[gi],
      conditions: spec.groups[gi].conditions.filter((_, i) => i !== ci),
    });

  const addCondition = (gi: number) => {
    const field = catalog[0];
    if (!field || spec.groups[gi].conditions.length >= MAX_CONDITIONS) return;
    setGroup(gi, {
      ...spec.groups[gi],
      conditions: [...spec.groups[gi].conditions, defaultCondition(field, optionCtx)],
    });
  };

  const addGroup = () => {
    const field = catalog[0];
    if (!field || spec.groups.length >= MAX_GROUPS) return;
    emit([...spec.groups, { op: "and", conditions: [defaultCondition(field, optionCtx)] }]);
  };

  const changeField = (gi: number, ci: number, id: string) => {
    const field = catalog.find((f) => f.id === id);
    if (field) setCondition(gi, ci, defaultCondition(field, optionCtx));
  };

  const changeCmp = (gi: number, ci: number, field: FieldOption, cmp: FilterCmp) => {
    const cond = spec.groups[gi].conditions[ci];
    // Keep the typed value when the new operator takes the same shape;
    // otherwise reset to a sane default for the new shape.
    const keep = shapeOf(field, cond.cmp) === shapeOf(field, cmp);
    const nextValue = keep ? cond.value : defaultValue(field, cmp, optionCtx);
    const base = { ...cond, cmp } as FilterCondition;
    if (nextValue === undefined) {
      delete (base as { value?: FilterValue }).value;
      setCondition(gi, ci, base);
    } else {
      setCondition(gi, ci, { ...base, value: nextValue });
    }
  };

  const groupsAtCap = spec.groups.length >= MAX_GROUPS;

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (spec.groups.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-surface/50 px-4 py-6 text-center",
          className,
        )}
      >
        <ListFilter className="h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          No filters applied — everything in your book matches.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={addGroup}>
          <Plus className="h-4 w-4" /> Condition
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* Header: root combinator + live count + clear */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Match
        </span>
        <OpToggle
          value={spec.op}
          onChange={(op) => emit(spec.groups, op)}
          labels={["All groups", "Any group"]}
          ariaLabel="Combine groups with"
        />
        <span className="flex-1" />
        <LiveCount filter={value} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-danger"
          onClick={() => onChange(null)}
        >
          Clear all
        </Button>
      </div>

      {spec.groups.map((group, gi) => {
        const condsAtCap = group.conditions.length >= MAX_CONDITIONS;
        return (
          <React.Fragment key={gi}>
            {gi > 0 && (
              <div className="text-center text-[11px] font-bold uppercase tracking-widest text-ink-3">
                {spec.op}
              </div>
            )}
            <div className="rounded-2xl border border-border/70 bg-surface p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Where</span>
                <OpToggle
                  value={group.op}
                  onChange={(op) => setGroup(gi, { ...group, op })}
                  labels={["All", "Any"]}
                  ariaLabel={`Combine conditions in group ${gi + 1} with`}
                />
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label={`Remove group ${gi + 1}`}
                  onClick={() => emit(spec.groups.filter((_, i) => i !== gi))}
                  className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                {group.conditions.map((cond, ci) => {
                  const field = fieldOptionFor(catalog, cond);
                  return (
                    <div key={ci} className="flex flex-wrap items-center gap-1.5">
                      <Select
                        aria-label="Field"
                        className="h-9 w-full py-1.5 sm:w-44"
                        value={field?.id ?? ""}
                        onChange={(e) => changeField(gi, ci, e.target.value)}
                      >
                        {!field && <option value="">Unknown field</option>}
                        {(["standard", "custom", "activity"] as const).map((g) => {
                          const opts = grouped.get(g);
                          if (!opts?.length) return null;
                          return (
                            <optgroup key={g} label={FIELD_GROUP_LABELS[g]}>
                              {opts.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.label}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </Select>
                      {field && (
                        <>
                          <Select
                            aria-label="Operator"
                            className="h-9 w-full py-1.5 sm:w-40"
                            value={cond.cmp}
                            onChange={(e) =>
                              changeCmp(gi, ci, field, e.target.value as FilterCmp)
                            }
                          >
                            {cmpsFor(field.family).map((c) => (
                              <option key={c} value={c}>
                                {CMP_LABELS[c]}
                              </option>
                            ))}
                          </Select>
                          <ConditionValue
                            field={field}
                            cond={cond}
                            onValue={(v) => {
                              const next = { ...cond } as FilterCondition & {
                                value?: FilterValue;
                              };
                              if (v === undefined) delete next.value;
                              else next.value = v;
                              setCondition(gi, ci, next);
                            }}
                            statusOptions={statusOptions}
                            campaignOptions={campaignOptions}
                            repOptions={repOptions}
                          />
                        </>
                      )}
                      <button
                        type="button"
                        aria-label="Remove condition"
                        onClick={() => removeCondition(gi, ci)}
                        className="ml-auto rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={condsAtCap}
                  onClick={() => addCondition(gi)}
                >
                  <Plus className="h-4 w-4" /> Condition
                </Button>
                {condsAtCap && (
                  <span className="text-xs text-muted-foreground">
                    Limit reached — up to {MAX_CONDITIONS} conditions per group.
                  </span>
                )}
              </div>
            </div>
          </React.Fragment>
        );
      })}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={groupsAtCap}
          onClick={addGroup}
        >
          <Plus className="h-4 w-4" /> Group
        </Button>
        {groupsAtCap && (
          <span className="text-xs text-muted-foreground">
            Limit reached — up to {MAX_GROUPS} groups.
          </span>
        )}
      </div>
    </div>
  );
}
