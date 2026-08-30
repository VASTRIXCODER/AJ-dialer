"use client";

import { useState } from "react";
import type { LeadPanelField } from "@/lib/db/lead-360";
import { cn } from "@/lib/utils";
import { PanelSection } from "./section-shell";

/**
 * EVERY resolved field on this lead — including the custom columns the leads
 * table's 4-column cap can't show. Core slots (under the org's own labels)
 * come first, then the import-captured custom fields. "Show raw values" flips
 * to the stored key + unformatted value, for debugging a mapping or an export.
 */
export function CustomFieldsSection({ fields }: { fields: LeadPanelField[] }) {
  const [raw, setRaw] = useState(false);
  if (!fields.length) return null;

  const core = fields.filter((f) => f.def.source === "core");
  const custom = fields.filter((f) => f.def.source === "custom");

  const renderGroup = (group: LeadPanelField[], heading: string) =>
    group.length > 0 && (
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          {heading}
        </p>
        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {group.map((f) => (
            <div
              key={f.def.key}
              className="flex items-baseline justify-between gap-3 border-b border-border/30 py-1.5 text-sm"
            >
              <dt
                className={cn(
                  "shrink-0 text-muted-foreground",
                  raw && "font-mono text-xs",
                )}
              >
                {raw ? f.def.key : f.def.label}
              </dt>
              <dd
                className={cn(
                  "min-w-0 break-words text-right font-medium",
                  raw && "font-mono text-xs",
                )}
              >
                {raw
                  ? f.value == null
                    ? "null"
                    : String(f.value)
                  : f.formatted}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );

  return (
    <PanelSection
      title="Details"
      action={
        <button
          type="button"
          onClick={() => setRaw((v) => !v)}
          aria-pressed={raw}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {raw ? "Show formatted" : "Show raw values"}
        </button>
      }
    >
      <div className="space-y-3">
        {renderGroup(core, "Core")}
        {renderGroup(custom, "From imports")}
        {custom.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No extra fields captured from imports for this record.
          </p>
        )}
      </div>
    </PanelSection>
  );
}
