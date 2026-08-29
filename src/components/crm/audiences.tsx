"use client";

import { AlertTriangle, ArrowRight, Layers, Star } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { AudienceCard } from "./crm-workspace";

// ─────────────────────────────────────────────────────────────────────────────
// Audiences — the saved populations this workspace works, as populations.
//
// Deliberately NOT a second filter builder. /leads owns FilterBuilder and every
// card here hands off to it; duplicating that grammar would give the product
// two places to author a filter and one of them would drift.
//
// Deliberately NO row counts either. Counting a saved filter is a full scan
// PER LIST — the smart-list module refuses to do it on read for exactly that
// reason, and a page that quietly ran ten of them would be the slowest screen
// in the product. What an audience owes you here is what it selects and whether
// it still works; the count is one click away in Leads.
// ─────────────────────────────────────────────────────────────────────────────

const TONE: Record<string, "neutral" | "primary" | "accent" | "success" | "warning" | "danger"> = {
  primary: "primary",
  accent: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
};

export function Audiences({
  audiences,
  canOpenLeads,
  leadNounPlural,
}: {
  audiences: AudienceCard[];
  canOpenLeads: boolean;
  leadNounPlural: string;
}) {
  if (audiences.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No audiences saved yet"
        description={`An audience is a saved way of selecting ${leadNounPlural} — everyone going cold, everyone who booked and didn't show. Save a filter in Leads and it appears here.`}
        action={canOpenLeads ? { label: "Open Leads", href: "/leads" } : undefined}
      />
    );
  }

  const broken = audiences.filter((a) => a.warnings.length > 0);

  return (
    <div className="space-y-4">
      {broken.length > 0 && (
        <SectionCard
          title={`${broken.length} audience${broken.length === 1 ? "" : "s"} won't select what it says`}
          description="Each references a field that no longer exists in this workspace's schema. A broken audience doesn't error — it quietly returns fewer rows, or none."
        >
          <ul className="space-y-1.5">
            {broken.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{a.name}</span>{" "}
                  <span className="text-muted-foreground">— {a.warnings.join("; ")}</span>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard
        title={`Audiences · ${audiences.length}`}
        description="Saved ways of selecting a population. Counts aren't shown here — each one is a full scan, so it stays a deliberate click in Leads."
      >
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {audiences.map((a) => (
            <li
              key={a.id}
              className="flex flex-col rounded-xl border border-border/70 bg-card p-3 shadow-soft"
            >
              <div className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {a.favorite && (
                      <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
                    )}
                    <span className="truncate text-sm font-semibold">{a.name}</span>
                  </span>
                </span>
                <Badge tone={TONE[a.tone] ?? "neutral"} className="shrink-0">
                  {a.shared ? "Shared" : "Private"}
                </Badge>
              </div>

              {a.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {a.description}
                </p>
              )}

              <p className="mt-2 text-xs text-muted-foreground">
                {a.conditions === 0
                  ? `Selects every ${leadNounPlural.replace(/s$/, "")} — no conditions.`
                  : `${a.conditions} condition${a.conditions === 1 ? "" : "s"}`}
                {a.warnings.length > 0 && (
                  <span className="ml-1.5 text-warning">· needs attention</span>
                )}
              </p>

              <div className="mt-auto pt-2.5">
                {a.href && canOpenLeads ? (
                  <Link
                    href={a.href}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    Open in Leads
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                ) : (
                  // A dead link is worse than a stated reason.
                  <p className="text-xs text-muted-foreground">
                    {canOpenLeads
                      ? "This audience can't be opened — its filter is too large to put in a link."
                      : "Leads is switched off for this workspace."}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
