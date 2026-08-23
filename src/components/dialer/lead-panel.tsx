"use client";

import {
  BatteryCharging,
  Bot,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Headphones,
  Loader2,
  Mail,
  MapPin,
  NotebookPen,
  Phone,
  PhoneCall,
  Search,
  Users,
  Sun,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CallDetailModal } from "@/components/calls/call-detail-modal";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Ring } from "@/components/ui/progress";
import {
  CORE_LEAD_FIELDS,
  formatFieldValue,
  leadFieldValue,
  type LeadFieldDef,
} from "@/lib/leads/field-schema";
import type { Lead } from "@/lib/types";
import { outcomeConfig } from "@/lib/status";
import type { CallOutcome } from "@/lib/types";
import {
  cn,
  digitsOnly,
  formatAddress,
  formatDuration,
  formatPhone,
  initials,
  relativeTime,
} from "@/lib/utils";

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
  fields,
  showCallHistory = true,
  showUpNext = true,
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
  /** The org's resolved field schema — drives stat tiles, chips & rows. */
  fields?: LeadFieldDef[];
  /** Layout toggles (Admin → Dialer layout). */
  showCallHistory?: boolean;
  showUpNext?: boolean;
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
        <LeadDetail
          lead={lead}
          upNext={showUpNext ? upNext : []}
          fields={fields ?? CORE_LEAD_FIELDS}
          showCallHistory={showCallHistory}
        />
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

/** The solar-era chips keep their icons; other labels get a neutral check. */
function chipIcon(label: string): typeof Car {
  if (label === "EV") return Car;
  if (label === "Pool") return Waves;
  if (label === "Battery") return BatteryCharging;
  return CheckCircle2;
}

function LeadDetail({
  lead,
  upNext,
  fields,
  showCallHistory,
}: {
  lead: Lead;
  upNext: Lead[];
  fields: LeadFieldDef[];
  showCallHistory: boolean;
}) {
  const name = `${lead.firstName} ${lead.lastName}`;
  // Stat tiles: the schema's first two money/number fields (solar: Utility
  // bill + Solar payment, exactly the old pair). The "(…)" unit suffix is
  // dropped — the tile is too small for it.
  // Visibility matters: a template-hidden slot the admin's schema editor
  // happened to pin (with both flags false) must NOT resurrect as a tile.
  const tiles = fields
    .filter(
      (f) =>
        (f.type === "currency" || f.type === "number") &&
        (f.showInTable || f.showInQualify),
    )
    .slice(0, 2);
  const tileLabel = (label: string) => label.replace(/\s*\(.*\)\s*$/, "");
  // Flag chips: every boolean the schema actually surfaces that is true on
  // this lead (multipleSystems stays invisible by default, as before).
  const flags = fields.filter(
    (f) =>
      f.type === "boolean" &&
      (f.showInTable || f.showInQualify) &&
      leadFieldValue(lead, f) === true,
  );
  const providerDef = fields.find((f) => f.key === "utilityProvider");
  const solarProviderDef = fields.find((f) => f.key === "solarProvider");

  return (
    <>
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <Avatar initials={initials(name)} tone={lead.assignedRepId ? "chart-1" : "chart-2"} size="lg" />
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
          {formatAddress(lead) && (
            <div className="flex items-start gap-2.5 text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words" title={formatAddress(lead)}>
                {formatAddress(lead)}
              </span>
            </div>
          )}
          {lead.email && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0" />
              <span className="truncate">{lead.email}</span>
            </div>
          )}
          {providerDef && lead.utilityProvider && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Zap className="h-4 w-4 shrink-0" />
              <span title={providerDef.label}>{lead.utilityProvider}</span>
            </div>
          )}
          {solarProviderDef && lead.solarProvider && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Sun className="h-4 w-4 shrink-0" />
              <span title={solarProviderDef.label}>{lead.solarProvider}</span>
            </div>
          )}
        </div>

        {tiles.length > 0 && (
          <div className={cn("mt-4 grid gap-2", tiles.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
            {tiles.map((def) => {
              const value = leadFieldValue(lead, def);
              return (
                <div key={def.key} className="rounded-xl bg-muted px-3 py-2">
                  <p className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {tileLabel(def.label)}
                  </p>
                  <p className="text-base font-bold tabular">
                    {value ? formatFieldValue(value, def.type) : "—"}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {flags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {flags.map((f) => {
              const Icon = chipIcon(f.label);
              return (
                <span
                  key={f.key}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-xs font-semibold text-accent"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {f.label}
                </span>
              );
            })}
          </div>
        )}

        {lead.notes && (
          <p className="mt-3 rounded-xl border border-dashed border-border p-2.5 text-xs text-muted-foreground">
            “{lead.notes}”
          </p>
        )}
      </div>

      {showCallHistory && <CallHistory leadId={lead.id} />}

      <div className={upNext.length ? "flex-1 p-5" : "hidden"}>
        <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Up next in queue
        </p>
        <ul className="space-y-2">
          {upNext.map((l) => (
            <li key={l.id} className="flex items-center gap-2.5">
              <Avatar
                initials={initials(`${l.firstName} ${l.lastName}`)}
                tone="muted"
                size="xs"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {l.firstName} {l.lastName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[l.city, l.state].filter(Boolean).join(", ") || "—"}
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

// ── Per-lead call history ────────────────────────────────────────────────────
// Two jobs: stop a rep re-dialing someone who was spoken to yesterday, and be
// the way BACK to that call. It used to be a dead list — you could see that a
// call happened but had no route to its notes, transcript or recording, which is
// exactly what you want at the moment you're about to dial the same person.
interface HistoryCall {
  id: string;
  startedAt: string;
  durationSec: number;
  outcome: CallOutcome | null;
  channel: string;
  hasNotes: boolean;
  hasRecording: boolean;
  hasTranscript: boolean;
}

function CallHistory({ leadId }: { leadId: string }) {
  const [calls, setCalls] = useState<HistoryCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setOpenId(null);
    fetch(`/api/leads/history?leadId=${encodeURIComponent(leadId)}`)
      .then((r) => r.json())
      .then((j) => setCalls((j.calls ?? []) as HistoryCall[]))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [leadId]);

  if (loading || calls.length === 0) return null;

  return (
    <div className="border-t border-border px-5 py-4">
      <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <PhoneCall className="h-3.5 w-3.5" />
        Call history ({calls.length})
      </p>
      <ul className="space-y-1">
        {calls.map((c) => {
          const cfg = c.outcome ? outcomeConfig[c.outcome] : null;
          const hasDetail = c.hasNotes || c.hasRecording || c.hasTranscript;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                title="Open this call — summary, notes, transcript and recording"
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
              >
                {c.channel === "ai" ? (
                  <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground tabular">
                  {relativeTime(c.startedAt)}
                </span>
                {c.durationSec > 0 && (
                  <span className="text-xs text-muted-foreground tabular">
                    {formatDuration(c.durationSec)}
                  </span>
                )}
                {/* What this call left behind, so the rep knows there's something
                    worth opening before they open it. */}
                {hasDetail && (
                  <span className="flex items-center gap-1 text-muted-foreground/70">
                    {c.hasRecording && <Headphones className="h-3 w-3" />}
                    {c.hasTranscript && <FileText className="h-3 w-3" />}
                    {c.hasNotes && <NotebookPen className="h-3 w-3" />}
                  </span>
                )}
                {cfg && (
                  <Badge
                    tone={cfg.tone === "success" ? "success" : cfg.tone === "danger" ? "danger" : cfg.tone === "warning" ? "warning" : "neutral"}
                    className="ml-auto text-[10px] px-1.5 py-0.5"
                  >
                    {cfg.label}
                  </Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {openId && (
        <CallDetailModal
          key={openId}
          callId={openId}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
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
    // Phone is stored E.164 ("+14085551234"); typing the formatted number shown
    // on screen ("(408) 555-1234") won't substring-match that, so also compare
    // digits-only once the query has enough of them to be a real number fragment.
    const needleDigits = digitsOnly(q);
    return queue.filter(
      (l) =>
        // Custom-field values join the haystack, so a rep can find a lead by a
        // policy number or job type their CSV carried — not just name/city.
        `${l.firstName} ${l.lastName} ${l.city} ${l.state} ${l.phone} ${l.utilityProvider} ${Object.values(
          l.customFields ?? {},
        ).join(" ")}`
          .toLowerCase()
          .includes(needle) ||
        (needleDigits.length >= 3 && digitsOnly(l.phone).includes(needleDigits)),
    );
  }, [q, queue]);

  /**
   * One row per HOUSEHOLD, not per phone number.
   *
   * Purchased/skip-traced lists ship a homeowner with several numbers, and the
   * importer dedupes on phone — correctly, they're all worth dialing — so each
   * number becomes its own lead row. Searching a name then returned the same
   * person ten times over, which is what reps were seeing.
   *
   * Grouped on name + full address so two genuinely different people who share
   * a name stay separate; only rows that are the same person at the same
   * address collapse. Nothing is discarded — the alternate numbers are still in
   * the dial queue, and the row shows how many there are.
   */
  const households = useMemo(() => {
    const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const byKey = new Map<string, Lead[]>();
    for (const l of results) {
      const key = [l.firstName, l.lastName, l.address, l.city, l.state].map(norm).join("|");
      const bucket = byKey.get(key);
      if (bucket) bucket.push(l);
      else byKey.set(key, [l]);
    }
    return [...byKey.values()];
  }, [results]);

  return (
    <Modal
      onClose={onClose}
      label="Search leads"
      maxWidth="max-w-md"
      panelClassName="max-h-[80vh] sm:max-h-[70vh]"
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
        {households.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No leads match “{q.trim()}”.
          </p>
        ) : (
          households.slice(0, 200).map((group) => {
            // Prefer the entry the dialer is already on, so picking the
            // household keeps the rep on the number they're working.
            const l = group.find((g) => g.id === currentId) ?? group[0];
            const extra = group.length - 1;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onPick(l.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/60 ${
                  group.some((g) => g.id === currentId) ? "bg-primary-soft" : ""
                }`}
              >
                <Avatar
                  initials={initials(`${l.firstName} ${l.lastName}`)}
                  tone="chart-2"
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
                {extra > 0 && (
                  <span
                    className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
                    title={`${group.length} numbers on file for this household`}
                  >
                    +{extra} number{extra === 1 ? "" : "s"}
                  </span>
                )}
                {l.aiScore != null && (
                  <span className="shrink-0 text-xs font-bold text-muted-foreground tabular">
                    {l.aiScore}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}
