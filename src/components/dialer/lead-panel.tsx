"use client";

import {
  BatteryCharging,
  Car,
  Mail,
  MapPin,
  Phone,
  Sun,
  Waves,
  Zap,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Ring } from "@/components/ui/progress";
import type { Lead } from "@/lib/types";
import { formatCurrency, formatPhone, initials } from "@/lib/utils";

export function LeadPanel({
  lead,
  upNext,
}: {
  lead: Lead | null;
  upNext: Lead[];
}) {
  if (!lead) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <Phone className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          No lead selected. Start a session to load your queue.
        </p>
      </div>
    );
  }

  const name = `${lead.firstName} ${lead.lastName}`;
  const flags = [
    { on: lead.hasEV, icon: Car, label: "EV" },
    { on: lead.hasPool, icon: Waves, label: "Pool" },
    { on: lead.hasBattery, icon: BatteryCharging, label: "Battery" },
  ].filter((f) => f.on);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <Avatar initials={initials(name)} color={lead.assignedRepId ? "#F97316" : "#0EA5E9"} size="lg" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold leading-tight">{name}</h3>
            <p className="truncate text-sm text-muted-foreground tabular">
              {formatPhone(lead.phone)}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone="primary" className="capitalize">
                {lead.status.replace("_", " ")}
              </Badge>
              <Badge tone="neutral">{lead.timezone}</Badge>
            </div>
          </div>
          {lead.aiScore != null && (
            <Ring value={lead.aiScore} size={56} stroke={5}>
              <span className="text-xs">{lead.aiScore}</span>
            </Ring>
          )}
        </div>

        <div className="mt-4 space-y-2 text-sm">
          <div className="flex items-start gap-2.5 text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {lead.address}, {lead.city}, {lead.state} {lead.zip}
            </span>
          </div>
          {lead.email && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0" />
              <span className="truncate">{lead.email}</span>
            </div>
          )}
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <Zap className="h-4 w-4 shrink-0" />
            <span>{lead.utilityProvider}</span>
          </div>
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <Sun className="h-4 w-4 shrink-0" />
            <span>{lead.solarProvider}</span>
          </div>
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

      <div className="flex-1 p-5">
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
    </div>
  );
}
