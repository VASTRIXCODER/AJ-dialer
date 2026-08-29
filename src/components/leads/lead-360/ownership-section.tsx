"use client";

import { CheckCircle2 } from "lucide-react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Badge } from "@/components/ui/badge";
import type { LeadPanel } from "@/lib/db/lead-360";
import type { IneligibleReason } from "@/lib/dialer/eligibility";
import { formatDay } from "@/lib/utils";
import { InfoRow, PanelSection } from "./section-shell";

/**
 * Plain-language labels for the eligibility evaluator's reason codes — the
 * "why can't I dial this one?" answer, in words a rep can act on.
 */
function reasonLabels(leadNoun: string): Record<IneligibleReason, string> {
  return {
    wrong_org: "Belongs to another workspace",
    not_assigned: `Not in your book — a teammate's ${leadNoun}`,
    blocked_status: "Status blocks dialing",
    status_not_selected: "Status isn't dialable",
    invalid_phone: "No dialable phone number",
    dnc: "On the Do Not Call list",
    outside_window: "Outside their calling hours",
    reserved_elsewhere: "Reserved by a teammate right now",
    active_call: "Already on a live call",
    max_attempts: "Attempt limit reached",
    cooldown: "In cooldown after a recent attempt",
    not_yet_eligible: "Snoozed until later",
    wrong_campaign: "In a different campaign",
    wrong_pack: "In a different pack",
  };
}

const DIALING_PREF_LABELS: Record<string, string> = {
  ai: "AI agent only",
  manual: "Manual dialing only",
  either: "AI or manual",
  none: "Do not dial automatically",
};

/** Who holds this lead, where it came from, and whether it can be dialed now. */
export function OwnershipSection({ panel }: { panel: LeadPanel }) {
  const vocab = useVocabulary();
  const labels = reasonLabels(vocab.leadNoun);
  const { meta, eligibility } = panel;

  return (
    <PanelSection title="Ownership & source">
      <dl className="divide-y divide-border/40">
        <InfoRow label="Source file">
          {meta.sourceFile ? (
            <span>
              {meta.sourceFile}
              {meta.originalRow != null && (
                <span className="text-muted-foreground"> · row {meta.originalRow}</span>
              )}
            </span>
          ) : null}
        </InfoRow>
        <InfoRow label="Imported">{meta.createdAt ? formatDay(meta.createdAt) : null}</InfoRow>
        <InfoRow label="Campaign">{panel.campaignName}</InfoRow>
        <InfoRow label="Pack">{panel.packLabel}</InfoRow>
        <InfoRow label="Group">{panel.groupLabel}</InfoRow>
        <InfoRow label="Uploaded by">{panel.ownerName}</InfoRow>
        <InfoRow label="Assigned to">{panel.assignedRepName}</InfoRow>
        <InfoRow label="Dialing preference">
          {DIALING_PREF_LABELS[meta.dialingPreference] ?? meta.dialingPreference}
        </InfoRow>
        <InfoRow label="Attempts">
          <span className="tabular">{meta.attemptCount}</span>
        </InfoRow>
        {panel.nextAppointment && (
          <InfoRow label={`Next ${vocab.appointmentNoun}`}>
            {panel.nextAppointment.scheduledAt
              ? formatDay(panel.nextAppointment.scheduledAt)
              : panel.nextAppointment.label || "scheduled"}
          </InfoRow>
        )}
        {panel.nextCallback && (
          <InfoRow label="Next callback">
            {panel.nextCallback.dueAt ? formatDay(panel.nextCallback.dueAt) : "due now"}
          </InfoRow>
        )}
      </dl>

      {/* Dial-eligibility verdict — a ✓ or the full list of reasons, never a
          silent omission (the evaluator collects ALL failing rules). */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-3">
        {eligibility.eligible ? (
          <Badge tone="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Ready to dial
          </Badge>
        ) : (
          eligibility.reasons.map((reason) => (
            <Badge
              key={reason}
              tone={reason === "dnc" || reason === "blocked_status" ? "danger" : "warning"}
            >
              {labels[reason] ?? reason.replace(/_/g, " ")}
            </Badge>
          ))
        )}
      </div>
    </PanelSection>
  );
}
