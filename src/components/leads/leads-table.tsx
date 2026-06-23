"use client";

import { motion } from "framer-motion";
import {
  BatteryCharging,
  Car,
  Loader2,
  PhoneCall,
  Search,
  Waves,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Lead, LeadStatus } from "@/lib/types";
import { leadStatusConfig } from "@/lib/status";
import { cn, formatCurrency, formatPhone, initials } from "@/lib/utils";

const FILTERS: Array<{ value: LeadStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "callback", label: "Callback" },
  { value: "appointment", label: "Appointment" },
];

export function LeadsTable({
  leads,
  campaigns = [],
}: {
  leads: Lead[];
  campaigns?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LeadStatus | "all">("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [busy, setBusy] = useState(false);

  const campaignName = useMemo(
    () => new Map(campaigns.map((c) => [c.id, c.name])),
    [campaigns],
  );

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const matchesFilter = filter === "all" || l.status === filter;
      const matchesCampaign =
        campaignFilter === "all" ||
        (campaignFilter === "none" ? !l.campaignId : l.campaignId === campaignFilter);
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.utilityProvider.toLowerCase().includes(q);
      return matchesFilter && matchesCampaign && matchesQuery;
    });
  }, [leads, filter, campaignFilter, query]);

  const allSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(filtered.map((l) => l.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function assign() {
    if (selected.size === 0 || !assignTo) return;
    setBusy(true);
    try {
      await fetch("/api/leads/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadIds: [...selected],
          campaignId: assignTo === "none" ? null : assignTo,
        }),
      });
      setSelected(new Set());
      setAssignTo("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, city, phone…"
            className="h-10 w-full rounded-xl border border-border bg-background/40 pl-9 pr-3 text-sm transition-all focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {campaigns.length > 0 && (
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background/60 px-2.5 text-sm font-medium focus-visible:border-primary/50 focus-visible:outline-none"
            >
              <option value="all">All campaigns</option>
              <option value="none">Unassigned</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  "relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-200",
                  active ? "text-background" : "bg-muted text-muted-foreground hover:bg-secondary",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="leads-filter"
                    className="absolute inset-0 z-0 rounded-lg bg-foreground"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{f.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bulk-assign bar */}
      {selected.size > 0 && campaigns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft/40 px-3 py-2">
          <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
          <span className="text-sm text-muted-foreground">Assign to</span>
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm focus-visible:border-primary/50 focus-visible:outline-none"
          >
            <option value="">Choose…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">— Remove from campaign —</option>
          </select>
          <Button size="sm" className="gap-1.5" disabled={!assignTo || busy} onClick={assign}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Apply
          </Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border/60 surface-glass">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {campaigns.length > 0 && (
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="h-4 w-4 cursor-pointer rounded border-border"
                    />
                  </th>
                )}
                <th className="px-4 py-3">Homeowner</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3 text-right">Bill</th>
                <th className="px-4 py-3">Home</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">AI</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((l, i) => {
                const name = `${l.firstName} ${l.lastName}`;
                const cfg = leadStatusConfig[l.status];
                const isSel = selected.has(l.id);
                return (
                  <motion.tr
                    key={l.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 14) * 0.025, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className={cn("group transition-colors hover:bg-muted/50", isSel && "bg-primary-soft/30")}
                  >
                    {campaigns.length > 0 && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleOne(l.id)}
                          aria-label={`Select ${name}`}
                          className="h-4 w-4 cursor-pointer rounded border-border"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={initials(name)} color="#3B82F6" size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold">{name}</p>
                          <p className="text-xs text-muted-foreground tabular">{formatPhone(l.phone)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.city}, {l.state}
                    </td>
                    <td className="px-4 py-3">
                      {l.campaignId && campaignName.get(l.campaignId) ? (
                        <Badge tone="accent">{campaignName.get(l.campaignId)}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular">
                      {l.utilityBill ? formatCurrency(l.utilityBill) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 text-muted-foreground">
                        {l.hasEV && <Car className="h-4 w-4" />}
                        {l.hasPool && <Waves className="h-4 w-4" />}
                        {l.hasBattery && <BatteryCharging className="h-4 w-4" />}
                        {!l.hasEV && !l.hasPool && !l.hasBattery && <span className="text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={cfg.tone}>{cfg.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={cn(
                          "font-bold tabular",
                          (l.aiScore ?? 0) >= 85
                            ? "text-success"
                            : (l.aiScore ?? 0) >= 70
                              ? "text-warning"
                              : "text-muted-foreground",
                        )}
                      >
                        {l.aiScore ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href="/dialer"
                        className={buttonVariants({
                          size: "sm",
                          variant: "ghost",
                          className: "gap-1.5 opacity-0 group-hover:opacity-100",
                        })}
                      >
                        <PhoneCall className="h-3.5 w-3.5" />
                        Call
                      </Link>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No leads match your filters.
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {leads.length} leads
      </p>
    </div>
  );
}
