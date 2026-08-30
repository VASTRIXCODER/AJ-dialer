"use client";

import {
  Bot,
  ChevronDown,
  Clock,
  Flag,
  LayoutGrid,
  List,
  Phone,
  PhoneOutgoing,
  Search,
  User,
  UserMinus,
} from "lucide-react";
import { DensityToggle, type Density } from "@/components/ui/density-toggle";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown-menu";
import { FilterChip } from "@/components/ui/filter-chip";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// FloorFilters — the floor's one control strip: facet chips (state, mode,
// stale-only), a campaign dropdown, rep search, and the grid/list + density
// switches. Pure and controlled — floor-board owns the state and does the
// actual filtering, so the same value drives grid and list identically.
// ─────────────────────────────────────────────────────────────────────────────

export interface FloorFilterValue {
  state: "all" | "connected" | "dialing" | "idle";
  mode: "all" | "manual" | "ai";
  campaign: string | null;
  q: string;
  staleOnly: boolean;
}

export const FLOOR_FILTER_DEFAULT: FloorFilterValue = {
  state: "all",
  mode: "all",
  campaign: null,
  q: "",
  staleOnly: false,
};

export type FloorView = "grid" | "list";

export function FloorFilters({
  value,
  onChange,
  campaigns,
  view,
  onViewChange,
  density,
  onDensityChange,
  className,
}: {
  value: FloorFilterValue;
  onChange: (value: FloorFilterValue) => void;
  /** Campaign names present on the board right now. */
  campaigns: string[];
  view: FloorView;
  onViewChange: (view: FloorView) => void;
  density: Density;
  onDensityChange: (density: Density) => void;
  className?: string;
}) {
  const set = (patch: Partial<FloorFilterValue>) => onChange({ ...value, ...patch });
  const toggleState = (s: FloorFilterValue["state"]) =>
    set({ state: value.state === s ? "all" : s });
  const toggleMode = (m: FloorFilterValue["mode"]) =>
    set({ mode: value.mode === m ? "all" : m });

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <FilterChip
        label="Connected"
        icon={Phone}
        active={value.state === "connected"}
        onToggle={() => toggleState("connected")}
      />
      <FilterChip
        label="Dialing"
        icon={PhoneOutgoing}
        active={value.state === "dialing"}
        onToggle={() => toggleState("dialing")}
      />
      <FilterChip
        label="Idle"
        icon={UserMinus}
        active={value.state === "idle"}
        onToggle={() => toggleState("idle")}
      />
      <span className="h-4 w-px bg-border/70" aria-hidden />
      <FilterChip
        label="Manual"
        icon={User}
        active={value.mode === "manual"}
        onToggle={() => toggleMode("manual")}
      />
      <FilterChip
        label="AI"
        icon={Bot}
        active={value.mode === "ai"}
        onToggle={() => toggleMode("ai")}
      />
      <FilterChip
        label="Stale only"
        icon={Clock}
        active={value.staleOnly}
        onToggle={() => set({ staleOnly: !value.staleOnly })}
        onClear={() => set({ staleOnly: false })}
      />

      {campaigns.length > 0 && (
        <Menu align="start">
          <MenuTrigger
            label="Filter by campaign"
            className={cn(
              "rounded-full py-1 pl-2.5 pr-2 text-xs font-semibold ring-1 ring-inset transition-colors",
              value.campaign
                ? "bg-primary-soft text-primary ring-primary/25"
                : "bg-muted text-muted-foreground ring-border/60 hover:bg-secondary hover:text-foreground",
            )}
          >
            <Flag className="h-3.5 w-3.5" />
            {value.campaign ?? "Campaign"}
            <ChevronDown className="h-3 w-3" />
          </MenuTrigger>
          <MenuItem onSelect={() => set({ campaign: null })}>All campaigns</MenuItem>
          <MenuSeparator />
          {campaigns.map((c) => (
            <MenuItem key={c} icon={Flag} onSelect={() => set({ campaign: c })}>
              {c}
            </MenuItem>
          ))}
        </Menu>
      )}

      <label className="relative ml-auto min-w-36 flex-1 sm:max-w-56 sm:flex-none">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <span className="sr-only">Search reps</span>
        <input
          type="search"
          value={value.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search reps…"
          className="w-full rounded-xl border border-border bg-surface py-1.5 pl-8 pr-3 text-xs font-medium text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <span
        role="group"
        aria-label="Board layout"
        className="inline-flex items-center gap-0.5 rounded-xl bg-muted/60 p-0.5"
      >
        {(
          [
            { v: "grid" as const, label: "Grid", icon: LayoutGrid },
            { v: "list" as const, label: "List", icon: List },
          ] as const
        ).map(({ v, label, icon: Icon }) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => onViewChange(v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === v
                ? "bg-card text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </span>

      <DensityToggle
        value={density}
        onChange={onDensityChange}
      />
    </div>
  );
}
