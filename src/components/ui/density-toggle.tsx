"use client";

import { Rows2, Rows3 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// DensityToggle — the one compact/comfortable switch, persisted PER SURFACE via
// a localStorage key so the floor, leads, and reports can each remember their
// own preference. Two real buttons (aria-pressed), labels always visible — the
// state is never icon-color alone.
//
// Persistence contract: the toggle WRITES localStorage[storageKey] on change;
// callers hydrate their initial value with useStoredDensity(storageKey), which
// reads in an effect (never in the initializer — SSR renders the default and a
// localStorage read during hydration would mismatch it).
// ─────────────────────────────────────────────────────────────────────────────

export type Density = "compact" | "comfortable";

function isDensity(v: unknown): v is Density {
  return v === "compact" || v === "comfortable";
}

/** Controlled density state, remembered per `storageKey` across visits. */
export function useStoredDensity(
  storageKey: string,
  initial: Density = "comfortable",
): [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (isDensity(stored)) setDensity(stored);
    } catch {
      /* storage may be blocked (private mode) — keep the default */
    }
  }, [storageKey]);
  return [density, setDensity];
}

export function DensityToggle({
  value,
  onChange,
  storageKey,
  className,
}: {
  value: Density;
  onChange: (value: Density) => void;
  /** localStorage key this surface persists its preference under. */
  storageKey?: string;
  className?: string;
}) {
  function pick(next: Density) {
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* persistence is best-effort */
      }
    }
    onChange(next);
  }

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
