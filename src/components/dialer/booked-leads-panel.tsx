"use client";

import { CalendarCheck2, PhoneCall } from "lucide-react";
import Link from "next/link";
import { LeadOpenLink } from "@/components/leads/lead-360/lead-open-link";
import { whenLabel } from "@/lib/appointments/time";
import type { BookedLead } from "@/lib/db/leads";
import { formatAddress, formatPhone, initials } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TableSkeleton } from "@/components/shared/skeletons";

// ─────────────────────────────────────────────────────────────────────────────
// The dialer's "Booked" tab: everyone who already has an appointment on the
// calendar. `getDialQueue` already excludes status "appointment" from the dial
// queue (it isn't in DIALABLE) — this tab is where those leads land instead of
// just vanishing the next time leads are reloaded, so the team can still see
// who's already converted.
// ─────────────────────────────────────────────────────────────────────────────

export function BookedLeadsPanel({ leads, loading }: { leads: BookedLead[]; loading: boolean }) {
  if (loading && leads.length === 0) {
    return (
      <div className="p-4">
        <TableSkeleton rows={5} />
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
        <CalendarCheck2 className="h-8 w-8 opacity-40" />
        <p className="text-sm font-medium">No booked appointments in your dial scope yet</p>
        <p className="max-w-sm text-xs">
          Once a lead is dispositioned "Appointment booked," they're skipped by the dial
          queue and show up here instead.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/60">
      {leads.map((l) => (
        <div key={l.id} className="flex items-center gap-3 px-5 py-3">
          <Avatar
            initials={initials(`${l.firstName} ${l.lastName}`) || "—"}
            tone="success"
            size="sm"
          />
          <div className="min-w-0 flex-1">
            {/* Name → Lead 360 (works mid-call — the drawer never remounts the
                dialer). */}
            <LeadOpenLink leadId={l.id} className="block truncate text-sm font-medium">
              {l.firstName} {l.lastName}
            </LeadOpenLink>
            <p className="truncate text-xs text-muted-foreground">
              {formatAddress(l)} · {formatPhone(l.phone)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <Badge tone="success" className="gap-1.5">
              <CalendarCheck2 className="h-3 w-3" />
              {whenLabel({ scheduledAt: l.scheduledAt, scheduledLabel: l.scheduledLabel })}
            </Badge>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <span className="text-xs text-muted-foreground">
          Skipped by the dial queue automatically — never re-dialed on reload.
        </span>
        <Link
          href="/appointments"
          className={buttonVariants({ size: "sm", variant: "outline", className: "gap-1.5 shrink-0" })}
        >
          <PhoneCall className="h-3.5 w-3.5" />
          View calendar
        </Link>
      </div>
    </div>
  );
}
