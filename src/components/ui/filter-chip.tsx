"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// FilterChip — the one pill for every toggleable filter facet.
//
// Two interactive parts, two real <button>s (never a button inside a button —
// that's invalid HTML and breaks keyboard focus): the pill toggles, the
// optional × clears. Both are plain buttons, so Tab/Enter/Space work for free;
// `aria-pressed` tells screen readers the toggle state the color implies.
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterChipProps {
  /** What this facet is ("Status", "Never dialed"). */
  label: string;
  /** The chosen value shown after the label ("Qualified"). Omit for flags. */
  value?: string;
  active: boolean;
  onToggle: () => void;
  /** When provided (and active), renders the × clear affordance. */
  onClear?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}

export function FilterChip({
  label,
  value,
  active,
  onToggle,
  onClear,
  icon: Icon,
  className,
}: FilterChipProps) {
  const showClear = Boolean(onClear && active);
  return (
    <span
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-full text-xs font-semibold transition-colors duration-[var(--dur-state)]",
        active
          ? "bg-primary-soft text-primary ring-1 ring-inset ring-primary/25"
          : "bg-muted text-muted-foreground ring-1 ring-inset ring-border/60 hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={cn(
          "inline-flex items-center gap-1.5 py-1 pl-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          showClear ? "pr-1.5" : "pr-2.5",
        )}
      >
        {/* Active carries a CHECK, not only a blue tint. The two states were
            the same radius, padding, weight and ring width, differing in fill
            colour alone — so "which of these eight filters are on" was a
            colour-discrimination task. */}
        {active ? (
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          Icon && <Icon className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className={active ? "font-bold" : undefined}>{label}</span>
        {value && (
          <span className={cn("font-normal", active ? "text-primary/80" : "text-ink-3")}>
            {value}
          </span>
        )}
      </button>
      {showClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${label} filter`}
          className="inline-flex items-center pr-2 pl-0.5 text-primary/70 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
