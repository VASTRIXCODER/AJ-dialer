"use client";

import { Info } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { LeadPanel } from "@/lib/db/lead-360";
import { InfoRow, PanelSection } from "./section-shell";

/**
 * Two DIFFERENT facts, deliberately never merged (the product rule in
 * src/lib/leads/area-code.ts): the address the lead PROVIDED, and where their
 * phone NUMBER's area code points. Numbers are portable — a 415 number can
 * live in Miami — so the inference is labeled as being about the number and
 * carries a tooltip explaining exactly that.
 */
export function LocationSection({ panel }: { panel: LeadPanel }) {
  const { lead, numberLocation } = panel;
  return (
    <PanelSection title="Location">
      <dl className="divide-y divide-border/40">
        <InfoRow label="Address">{lead.address || null}</InfoRow>
        <InfoRow label="City">{lead.city || null}</InfoRow>
        <InfoRow label="State">{lead.state || null}</InfoRow>
        <InfoRow label="ZIP">{lead.zip || null}</InfoRow>
        {lead.county && <InfoRow label="County">{lead.county}</InfoRow>}
        <InfoRow label="Timezone">{lead.timezone || null}</InfoRow>
      </dl>

      <div className="mt-3 border-t border-border/40 pt-3">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground">
            Number location — inferred from area code
          </p>
          <Tooltip
            content="Inferred from the phone number's area code alone. Numbers are portable, so this describes the number — not necessarily where this person actually is."
            side="top"
          >
            <button
              type="button"
              aria-label="How number location is inferred"
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
        {numberLocation ? (
          <p className="mt-1 text-sm font-medium">
            {numberLocation.region}, {numberLocation.state}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {numberLocation.tz}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Unknown area code — nothing to infer.
          </p>
        )}
      </div>
    </PanelSection>
  );
}
