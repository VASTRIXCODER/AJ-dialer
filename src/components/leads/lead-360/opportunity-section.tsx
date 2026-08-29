"use client";

import { AlarmClock, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LeadPanel } from "@/lib/db/lead-360";
import { nextActionLabel, STAGE_LABELS } from "@/lib/opportunities/why-now";
import { relativeTime } from "@/lib/utils";
import { PanelSection } from "./section-shell";

// ─────────────────────────────────────────────────────────────────────────────
// Where this record stands — the sales state that has existed on every lead
// since PART 37 and appeared on no screen.
//
// The speed-to-lead strip is the part that has to be careful. Each leg can be
// null, and a null leg renders "—", never "0": zero minutes to first contact is
// a real and excellent number, and printing it for a record nobody has called
// would be a lie in the flattering direction.
// ─────────────────────────────────────────────────────────────────────────────

type Opportunity = NonNullable<LeadPanel["opportunity"]>;

export function OpportunitySection({ opportunity }: { opportunity: Opportunity | null }) {
  // Nothing to say, so nothing rendered — no reserved height, no empty card.
  if (!opportunity) return null;

  const o = opportunity;
  const closed = o.opStatus === "closed";

  return (
    <PanelSection title="Opportunity">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={closed ? "neutral" : "primary"}>
          {STAGE_LABELS[o.stage] ?? o.stage}
        </Badge>
        {o.stageEnteredAt && (
          <span className="text-xs text-muted-foreground">
            since {relativeTime(o.stageEnteredAt)}
          </span>
        )}
        {closed && o.closeReason && (
          <Badge tone="neutral">Closed · {STAGE_LABELS[o.closeReason] ?? o.closeReason}</Badge>
        )}
        {o.backfilled && (
          // The clocks below were inferred by the backfill from Phase 1 status,
          // not observed as they happened. Saying so is the difference between
          // a measurement and a guess wearing a measurement's clothes.
          <Badge tone="warning" className="gap-1">
            <Info className="h-3 w-3" /> Reconstructed
          </Badge>
        )}
      </div>

      {o.nextActionKind && (
        <p className="mt-2 flex items-center gap-1.5 text-sm">
          <AlarmClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>
            Next: <span className="font-medium">{nextActionLabel(o.nextActionKind)}</span>
            {o.nextActionDueAt ? ` · ${relativeTime(o.nextActionDueAt)}` : " · no date set"}
          </span>
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Stat label="Attempts" value={String(o.attemptCount)} />
        <Stat label="Conversations" value={String(o.contactCount)} />
        <Stat
          label="Last worked"
          value={o.lastTouchedAt ? relativeTime(o.lastTouchedAt) : "never"}
        />
      </dl>

      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Speed to lead
        {o.backfilled && <span className="ml-1 normal-case font-medium">· reconstructed</span>}
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat label="Received" value={when(o.firstReceivedAt)} />
        <Stat label="Assigned" value={gap(o.firstReceivedAt, o.firstAssignedAt)} />
        <Stat label="First call" value={gap(o.firstReceivedAt, o.firstAttemptedAt)} />
        <Stat label="First contact" value={gap(o.firstReceivedAt, o.firstContactedAt)} />
      </dl>
    </PanelSection>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-semibold tabular">{value}</dd>
    </div>
  );
}

function when(at: string | null): string {
  return at ? relativeTime(at) : "—";
}

/**
 * How long the leg took. "—" whenever either end is missing — the leg didn't
 * happen, and rendering "0m" for it would read as instant.
 */
function gap(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms)) return "—";
  // A negative gap means the clocks disagree (a backfill artefact, mostly).
  // Say so rather than printing a nonsense duration.
  if (ms < 0) return "out of order";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
