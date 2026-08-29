import Link from "next/link";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// LeadCountsRow — the 8 drillable tiles above the leads table.
//
// PRESENTATIONAL and server-component-friendly: the counts arrive as props
// (getLeadCounts in src/lib/db/leads-filter.ts computes them) and each tile is
// a plain <Link> whose destination the CALLER builds via `hrefFor` — this file
// knows nothing about the leads page's URL grammar, so the same row can drill
// into filter params today and saved views later without changing here.
//
// LEAD_COUNT_DEFINITIONS is the human-readable contract: label + definition per
// tile, worded to match docs/phase-1/metric-glossary.md ("Lead counts") — the
// glossary is the source, this map is its rendered twin, and
// tests/lead-counts-defs.test.ts pins the key set to the LeadCounts shape.
// ─────────────────────────────────────────────────────────────────────────────

export type LeadCountKey =
  | "active"
  | "dialEligible"
  | "assigned"
  | "unassigned"
  | "neverDialed"
  | "attempted"
  | "dnc"
  | "archived";

export interface LeadCountDefinition {
  /** Tile label — the glossary's tile name. */
  label: string;
  /** Tooltip body — the glossary definition, worded for humans. */
  definition: string;
}

/** Wording matches docs/phase-1/metric-glossary.md § "Lead counts". Counts are
 *  unique lead ROWS (not unique phone numbers), scoped supervisor=org /
 *  rep=own+assigned. */
export const LEAD_COUNT_DEFINITIONS: Record<LeadCountKey, LeadCountDefinition> = {
  active: {
    label: "All active",
    definition: "Not archived, status is not DNC.",
  },
  dialEligible: {
    label: "Dial-eligible",
    definition:
      "Passes the eligibility predicate right now: status dialable, valid phone, not DNC, not reserved, cooldown and max-attempts clear.",
  },
  assigned: {
    label: "Assigned",
    definition: "Active and has an assigned rep.",
  },
  unassigned: {
    label: "Unassigned",
    definition: "Active and lacks an assigned rep.",
  },
  neverDialed: {
    label: "Never dialed",
    definition: "No dial attempts and never contacted, with a still-dialable status.",
  },
  attempted: {
    label: "Previously attempted",
    definition: "At least one dial attempt, or a contact on record.",
  },
  dnc: {
    label: "DNC / suppressed",
    definition: "Status DNC, or the number is on the do-not-call list.",
  },
  archived: {
    label: "Archived / invalid",
    definition: "Archived, or no dialable phone on file.",
  },
};

/** Render order: healthy book first, exclusions last. */
const TILE_ORDER: LeadCountKey[] = [
  "active",
  "dialEligible",
  "assigned",
  "unassigned",
  "neverDialed",
  "attempted",
  "dnc",
  "archived",
];

export interface LeadCountsRowProps {
  counts: Record<LeadCountKey, number>;
  /** Where each tile drills to — the caller owns the URL grammar. */
  hrefFor: (key: LeadCountKey) => string;
  /** Highlights the tile the current view is already drilled into. */
  active?: LeadCountKey | null;
  className?: string;
}

export function LeadCountsRow({ counts, hrefFor, active, className }: LeadCountsRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8",
        className,
      )}
    >
      {TILE_ORDER.map((key) => {
        const def = LEAD_COUNT_DEFINITIONS[key];
        const isActive = active === key;
        const warn = key === "dnc" || key === "archived";
        return (
          <Link
            key={key}
            href={hrefFor(key)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "group rounded-xl border bg-card px-3 py-2 shadow-soft transition-all duration-200 hover:shadow-lift",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isActive
                ? "border-primary/40 ring-1 ring-inset ring-primary/25"
                : "border-border/70 hover:border-border",
            )}
          >
            {/* TODO: swap title= for <Tooltip> once src/components/ui/tooltip.tsx
                lands (being built in parallel) — native title has no styling
                and a hover delay we don't control. */}
            <div
              title={def.definition}
              className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {def.label}
            </div>
            <div
              className={cn(
                "tabular mt-0.5 text-lg font-semibold leading-tight",
                warn ? "text-muted-foreground" : "text-foreground",
                isActive && "text-primary",
              )}
            >
              {(counts[key] ?? 0).toLocaleString()}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
