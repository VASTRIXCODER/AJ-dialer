"use client";

import { motion } from "framer-motion";
import {
  BatteryCharging,
  Car,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  Users,
  Sun,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { Ring } from "@/components/ui/progress";
import type { Lead } from "@/lib/types";
import { formatCurrency, formatNumber, formatPhone, initials } from "@/lib/utils";

// How many search results the browse sheet renders at once. Large queues stay
// reachable via the search box; this just caps the DOM so it never janks.
const BROWSE_CAP = 300;

export function LeadPanel({
  lead,
  upNext,
  queue = [],
  index = 0,
  total = 0,
  onPrev,
  onNext,
  onSelect,
  navDisabled = false,
  onLoadLeads,
  loadingLeads = false,
}: {
  lead: Lead | null;
  upNext: Lead[];
  queue?: Lead[];
  index?: number;
  total?: number;
  onPrev?: () => void;
  onNext?: () => void;
  onSelect?: (leadId: string) => void;
  navDisabled?: boolean;
  /** Pull the shared lead pool into the dialer on demand. */
  onLoadLeads?: () => void;
  loadingLeads?: boolean;
}) {
  const [browseOpen, setBrowseOpen] = useState(false);

  const hasNav = total > 0 && Boolean(onPrev && onNext);

  return (
    <div className="flex h-full flex-col">
      {/* Lead navigation — browse / pick any lead, not just chronological */}
      {hasNav && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={navDisabled}
            aria-label="Previous lead"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setBrowseOpen(true)}
            disabled={navDisabled}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/70 px-2 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-40"
          >
            <Users className="h-3.5 w-3.5" />
            Lead {Math.min(index + 1, total)} of {total}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={navDisabled}
            aria-label="Next lead"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {!lead ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Phone className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            No leads loaded yet. Pull your shared lead list into the dialer to start.
          </p>
          {onLoadLeads && (
            <Button
              size="sm"
              className="gap-2"
              onClick={onLoadLeads}
              disabled={loadingLeads}
            >
              {loadingLeads ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Users className="h-4 w-4" />
              )}
              Load leads
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            …or dial a specific number from the keypad.
          </p>
        </div>
      ) : (
        <LeadDetail lead={lead} upNext={upNext} />
      )}

      {browseOpen && (
        <LeadBrowser
          queue={queue}
          currentId={lead?.id ?? null}
          onPick={(id) => {
            onSelect?.(id);
            setBrowseOpen(false);
          }}
          onClose={() => setBrowseOpen(false)}
        />
      )}
    </div>
  );
}

function LeadDetail({ lead, upNext }: { lead: Lead; upNext: Lead[] }) {
  const name = `${lead.firstName} ${lead.lastName}`;
  const flags = [
    { on: lead.hasEV, icon: Car, label: "EV" },
    { on: lead.hasPool, icon: Waves, label: "Pool" },
    { on: lead.hasBattery, icon: BatteryCharging, label: "Battery" },
  ].filter((f) => f.on);

  return (
    <>
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <Avatar initials={initials(name)} color={lead.assignedRepId ? "#3B82F6" : "#0EA5E9"} size="lg" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold leading-tight">{name}</h3>
            <p className="truncate text-sm text-muted-foreground tabular">
              {formatPhone(lead.phone)}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone="primary" className="capitalize">
                {lead.status.replace("_", " ")}
              </Badge>
              {lead.timezone && <Badge tone="neutral">{lead.timezone}</Badge>}
            </div>
          </div>
          {lead.aiScore != null && (
            <Ring value={lead.aiScore} size={56} stroke={5}>
              <span className="text-xs">{lead.aiScore}</span>
            </Ring>
          )}
        </div>

        <div className="mt-4 space-y-2 text-sm">
          {(lead.address || lead.city) && (
            <div className="flex items-start gap-2.5 text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {[lead.address, lead.city, lead.state].filter(Boolean).join(", ")}{" "}
                {lead.zip}
              </span>
            </div>
          )}
          {lead.email && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0" />
              <span className="truncate">{lead.email}</span>
            </div>
          )}
          {lead.utilityProvider && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Zap className="h-4 w-4 shrink-0" />
              <span>{lead.utilityProvider}</span>
            </div>
          )}
          {lead.solarProvider && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Sun className="h-4 w-4 shrink-0" />
              <span>{lead.solarProvider}</span>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Utility bill
            </p>
            <p className="text-base font-bold tabular">
              {lead.utilityBill ? formatCurrency(lead.utilityBill) : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-muted px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Solar pmt
            </p>
            <p className="text-base font-bold tabular">
              {lead.solarPayment ? formatCurrency(lead.solarPayment) : "—"}
            </p>
          </div>
        </div>

        {flags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {flags.map((f) => (
              <span
                key={f.label}
                className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-xs font-semibold text-accent"
              >
                <f.icon className="h-3.5 w-3.5" />
                {f.label}
              </span>
            ))}
          </div>
        )}

        {lead.notes && (
          <p className="mt-3 rounded-xl border border-dashed border-border p-2.5 text-xs text-muted-foreground">
            “{lead.notes}”
          </p>
        )}
      </div>

      <div className={upNext.length ? "flex-1 p-5" : "hidden"}>
        <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Up next in queue
        </p>
        <ul className="space-y-2">
          {upNext.map((l) => (
            <li key={l.id} className="flex items-center gap-2.5">
              <Avatar
                initials={initials(`${l.firstName} ${l.lastName}`)}
                color="#94a3b8"
                size="xs"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {l.firstName} {l.lastName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {l.city}, {l.state}
                </p>
              </div>
              {l.aiScore != null && (
                <span className="text-xs font-bold text-muted-foreground tabular">
                  {l.aiScore}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ── Browse / pick any lead ──────────────────────────────────────────────────
function LeadBrowser({
  queue,
  currentId,
  onPick,
  onClose,
}: {
  queue: Lead[];
  currentId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return queue;
    return queue.filter((l) =>
      `${l.firstName} ${l.lastName} ${l.city} ${l.state} ${l.phone} ${l.utilityProvider}`
        .toLowerCase()
        .includes(needle),
    );
  }, [q, queue]);

  return (
    <Portal>
    <motion.div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-0 bg-background/70 backdrop-blur-xl"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="glass relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border/60 shadow-lift sm:max-h-[70vh] sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search leads by name, city, phone…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No leads match “{q.trim()}”.
            </p>
          ) : (
            <>
              {results.slice(0, BROWSE_CAP).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onPick(l.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/60 ${
                    l.id === currentId ? "bg-primary-soft" : ""
                  }`}
                >
                  <Avatar
                    initials={initials(`${l.firstName} ${l.lastName}`)}
                    color="#0EA5E9"
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {l.firstName} {l.lastName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground tabular">
                      {formatPhone(l.phone)} · {[l.city, l.state].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  {l.aiScore != null && (
                    <span className="shrink-0 text-xs font-bold text-muted-foreground tabular">
                      {l.aiScore}
                    </span>
                  )}
                </button>
              ))}
              {results.length > BROWSE_CAP && (
                <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                  Showing the first {formatNumber(BROWSE_CAP)} of{" "}
                  {formatNumber(results.length)} — type to narrow your search.
                </p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
    </Portal>
  );
}
