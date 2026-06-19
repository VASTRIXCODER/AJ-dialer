"use client";

import { motion } from "framer-motion";
import {
  BatteryCharging,
  Car,
  PhoneCall,
  Search,
  Waves,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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

export function LeadsTable({ leads }: { leads: Lead[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LeadStatus | "all">("all");

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const matchesFilter = filter === "all" || l.status === filter;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.utilityProvider.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [leads, filter, query]);

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
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  "relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-200",
                  active
                    ? "text-background"
                    : "bg-muted text-muted-foreground hover:bg-secondary",
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

      <div className="overflow-hidden rounded-2xl border border-border/60 surface-glass">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Homeowner</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Utility</th>
                <th className="px-4 py-3 text-right">Bill</th>
                <th className="px-4 py-3 text-right">Solar</th>
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
                return (
                  <motion.tr
                    key={l.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 14) * 0.025, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="group transition-colors hover:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={initials(name)} color="#3B82F6" size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold">{name}</p>
                          <p className="text-xs text-muted-foreground tabular">
                            {formatPhone(l.phone)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.city}, {l.state}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{l.utilityProvider}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular">
                      {l.utilityBill ? formatCurrency(l.utilityBill) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-muted-foreground">
                      {l.solarPayment ? formatCurrency(l.solarPayment) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 text-muted-foreground">
                        {l.hasEV && <Car className="h-4 w-4" />}
                        {l.hasPool && <Waves className="h-4 w-4" />}
                        {l.hasBattery && <BatteryCharging className="h-4 w-4" />}
                        {!l.hasEV && !l.hasPool && !l.hasBattery && (
                          <span className="text-xs">—</span>
                        )}
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
