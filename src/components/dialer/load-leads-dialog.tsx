"use client";

import { Check, CircleHelp, Layers, MapPin, Megaphone, PenLine, Users, X } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { applyLabelOverride } from "@/lib/leads/group-labels";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { GroupFilter } from "./dialer-context";

// ─────────────────────────────────────────────────────────────────────────────
// The picker that appears right after "Load leads" fetches the queue. Before
// this, the only way to narrow WHICH leads a session dialed was a small inline
// campaign dropdown — there was no way at all to dial just one lead "dropbox"
// (the org's intake groups from the CSV import flow). This surfaces both
// choices, with live counts, the moment leads land in the dialer, and can be
// reopened any time to change them without re-fetching.
//
// The group list is per-org now, so options are built from the org's own groups
// (threaded through DialerConfig) unioned with any key the loaded leads still
// carry — a lead whose group was deleted stays reachable rather than becoming
// undialable by filter.
// ─────────────────────────────────────────────────────────────────────────────

/** Readable names for the ORIGINAL fixed keys, for leads still carrying one
 *  whose group row has since been removed. */
const LEGACY_GROUP_LABELS: Record<string, string> = {
  fresno: "Fresno",
  houston: "Houston",
  dallas: "Dallas",
  california: "California",
  manual: "Manual Dialing",
};

function matchesGroup(l: Lead, g: GroupFilter): boolean {
  if (g === "all") return true;
  if (g === "unsorted") return !l.leadGroup;
  return l.leadGroup === g;
}

export function groupLabel(
  g: GroupFilter,
  overrides?: Record<string, string> | null,
  groups?: { key: string; label: string }[] | null,
): string {
  if (g === "all") return "All groups";
  if (g === "unsorted") return "Miscellaneous";
  const own = groups?.find((x) => x.key === g)?.label;
  return applyLabelOverride(g, own ?? LEGACY_GROUP_LABELS[g] ?? g, overrides);
}

export function LoadLeadsDialog({
  leads,
  campaigns,
  campaignFilter,
  onCampaignFilterChange,
  groupFilter,
  onGroupFilterChange,
  onClose,
  leadGroupLabels,
  leadGroups,
}: {
  /** The full, just-loaded dial queue (before any filter is applied). */
  leads: Lead[];
  campaigns: { id: string; name: string }[];
  campaignFilter: string;
  onCampaignFilterChange: (id: string) => void;
  groupFilter: GroupFilter;
  onGroupFilterChange: (g: GroupFilter) => void;
  onClose: () => void;
  /** Legacy per-org display-label overrides (still honored on top of labels). */
  leadGroupLabels?: Record<string, string>;
  /** The org's own intake groups, in display order. */
  leadGroups?: { key: string; label: string }[];
}) {
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: leads.length, unsorted: 0 };
    for (const g of leadGroups ?? []) counts[g.key] = 0;
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

  // Org groups first (in their configured order), then any orphan key the
  // loaded leads still carry, then Miscellaneous.
  const groupKeys = useMemo(() => {
    const keys = (leadGroups ?? []).map((g) => g.key);
    const seen = new Set(keys);
    for (const l of leads) {
      if (l.leadGroup && !seen.has(l.leadGroup)) {
        seen.add(l.leadGroup);
        keys.push(l.leadGroup);
      }
    }
    return keys;
  }, [leadGroups, leads]);

  const groupOptions: { value: GroupFilter; label: string; icon: typeof MapPin }[] = [
    { value: "all", label: "All groups", icon: Layers },
    ...groupKeys.map((g) => ({
      value: g as GroupFilter,
      icon: g === "manual" ? PenLine : MapPin,
      label: groupLabel(g, leadGroupLabels, leadGroups),
    })),
    { value: "unsorted", label: "Miscellaneous", icon: CircleHelp },
  ];

  return (
    <Modal onClose={onClose} label="Choose leads to dial">
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

      <div className="space-y-5 overflow-y-auto p-5">
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
    </Modal>
  );
}
