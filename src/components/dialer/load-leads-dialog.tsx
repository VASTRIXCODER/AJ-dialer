"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, CircleHelp, Layers, MapPin, Megaphone, PenLine, Users, X } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Portal } from "@/components/ui/portal";
import { LEAD_GROUPS, type Lead, type LeadGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { GroupFilter } from "./dialer-context";

// ─────────────────────────────────────────────────────────────────────────────
// The picker that appears right after "Load leads" fetches the queue. Before
// this, the only way to narrow WHICH leads a session dialed was a small inline
// campaign dropdown — there was no way at all to dial just one lead "dropbox"
// (the Fresno / Houston / Dallas / California / Manual intake groups from the
// CSV import flow). This surfaces both choices, with live counts, the moment
// leads land in the dialer, and can be reopened any time to change them
// without re-fetching.
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_META: Record<LeadGroup, { label: string; icon: typeof MapPin }> = {
  fresno: { label: "Fresno", icon: MapPin },
  houston: { label: "Houston", icon: MapPin },
  dallas: { label: "Dallas", icon: MapPin },
  california: { label: "California", icon: MapPin },
  manual: { label: "Manual Dialing", icon: PenLine },
};

function matchesGroup(l: Lead, g: GroupFilter): boolean {
  if (g === "all") return true;
  if (g === "unsorted") return !l.leadGroup;
  return l.leadGroup === g;
}

export function groupLabel(g: GroupFilter): string {
  if (g === "all") return "All groups";
  if (g === "unsorted") return "Unsorted";
  return GROUP_META[g].label;
}

export function LoadLeadsDialog({
  leads,
  campaigns,
  campaignFilter,
  onCampaignFilterChange,
  groupFilter,
  onGroupFilterChange,
  onClose,
}: {
  /** The full, just-loaded dial queue (before any filter is applied). */
  leads: Lead[];
  campaigns: { id: string; name: string }[];
  campaignFilter: string;
  onCampaignFilterChange: (id: string) => void;
  groupFilter: GroupFilter;
  onGroupFilterChange: (g: GroupFilter) => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: leads.length, unsorted: 0 };
    for (const g of LEAD_GROUPS) counts[g] = 0;
    for (const l of leads) {
      if (l.leadGroup) counts[l.leadGroup] = (counts[l.leadGroup] ?? 0) + 1;
      else counts.unsorted += 1;
    }
    return counts;
  }, [leads]);

  const hasGroups = leads.some((l) => l.leadGroup) || groupCounts.unsorted > 0;

  const matchCount = useMemo(
    () =>
      leads.filter(
        (l) =>
          matchesGroup(l, groupFilter) &&
          (!campaignFilter || l.campaignId === campaignFilter),
      ).length,
    [leads, groupFilter, campaignFilter],
  );

  const groupOptions: { value: GroupFilter; label: string; icon: typeof MapPin }[] = [
    { value: "all", label: "All groups", icon: Layers },
    ...LEAD_GROUPS.map((g) => ({ value: g as GroupFilter, ...GROUP_META[g] })),
    { value: "unsorted", label: "Unsorted", icon: CircleHelp },
  ];

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 bg-background/70 backdrop-blur-xl"
          onClick={onClose}
        />
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="glass relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border/60 shadow-lift sm:rounded-2xl"
        >
          <div className="flex items-start gap-3 border-b border-border/60 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">Choose leads to dial</h2>
              <p className="text-sm text-muted-foreground">
                {leads.length} lead{leads.length === 1 ? "" : "s"} loaded — narrow it to a
                specific dropbox or campaign.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-5 p-5">
            {hasGroups && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Lead group
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {groupOptions.map((opt) => {
                    const selected = groupFilter === opt.value;
                    const count = groupCounts[opt.value] ?? 0;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onGroupFilterChange(opt.value)}
                        disabled={count === 0 && opt.value !== "all"}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-surface text-muted-foreground hover:border-primary/50 hover:text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                        {selected ? (
                          <Check className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <Badge tone="neutral" className="shrink-0">
                            {count}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {campaigns.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Megaphone className="h-3.5 w-3.5" /> Campaign
                </p>
                <Select
                  value={campaignFilter}
                  onChange={(e) => onCampaignFilterChange(e.target.value)}
                  aria-label="Filter by campaign"
                >
                  <option value="">All campaigns</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border/60 p-4">
            <span className="text-sm text-muted-foreground">
              <b className="text-foreground tabular">{matchCount}</b> lead
              {matchCount === 1 ? "" : "s"} ready to dial
            </span>
            <Button size="sm" onClick={onClose} className="gap-1.5">
              <Check className="h-3.5 w-3.5" />
              Start dialing
            </Button>
          </div>
        </motion.div>
      </div>
    </Portal>
  );
}
