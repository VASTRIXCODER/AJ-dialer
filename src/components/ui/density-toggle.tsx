"use client";

import { Rows2, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Density } from "@/lib/ui-density";

// ─────────────────────────────────────────────────────────────────────────────
// DensityToggle — the compact/comfortable switch. Two real buttons
// (aria-pressed), labels always visible; the state is never icon-colour alone.
//
// It used to persist PER SURFACE under a caller-supplied localStorage key, and
// `useStoredDensity` hydrated each surface separately. That is why the product
// had three densities: the dialer's lanes, the monitor's floor and the
// appointments list each remembered a different answer, and /leads — the
// biggest grid of all — had no control at all.
//
// Persistence now belongs to the workspace: `useDensity()` from
// src/components/layout/density.tsx owns it, writes it to the rep's profile so
// it follows them between machines, and seeds the first paint server-side.
// This component is presentation only.
// ─────────────────────────────────────────────────────────────────────────────

export type { Density };

export function DensityToggle({
  value,
  onChange,
  className,
}: {
  value: Density;
  onChange: (value: Density) => void;
  className?: string;
}) {
  const pick = onChange;

  const options: { value: Density; label: string; icon: typeof Rows2 }[] = [
    { value: "comfortable", label: "Cozy", icon: Rows2 },
    { value: "compact", label: "Compact", icon: Rows3 },
  ];

  return (
    <span
      role="group"
      aria-label="Display density"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl bg-muted/60 p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => pick(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {o.label}
          </button>
        );
      })}
    </span>
  );
}
