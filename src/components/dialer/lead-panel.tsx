"use client";

import {
  AlertTriangle,
  BatteryCharging,
  Bot,
  Car,
  Check,
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
  ScanSearch,
  Search,
  Users,
  Sun,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CallDetailModal } from "@/components/calls/call-detail-modal";
import { useVocabulary } from "@/components/layout/vocabulary";
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
  canReverseSearch = false,
  onLeadPatched,
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
  /** Viewer holds `leads.reverseSearch` (managers+). Draws the skip-trace
   *  control; the API re-checks the permission regardless. */
  canReverseSearch?: boolean;
  /** Merge a patch into the queued lead so an applied number shows at once. */
  onLeadPatched?: (leadId: string, patch: Partial<Lead>) => void;
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
          canReverseSearch={canReverseSearch}
          onLeadPatched={onLeadPatched}
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

interface ReverseSearchCandidate {
  phone: string;
  lineType: "mobile" | "landline" | "voip" | "unknown";
  confidence: number | null;
  matchedName: string | null;
  isCurrent: boolean;
}

const LINE_TYPE_LABEL: Record<ReverseSearchCandidate["lineType"], string> = {
  mobile: "Mobile",
  landline: "Landline",
  voip: "VoIP",
  unknown: "Unknown",
};

/**
 * Skip trace: the lead's name/address → candidate phone numbers, for leads
 * whose number is missing or dead. Managers+ only (`leads.reverseSearch`).
 *
 * Results are PROPOSED, never auto-applied. A skip-trace hit is a broker's
 * probabilistic match on a person, so applying one is an explicit click that
 * shows what it would overwrite — auto-filling would quietly discard a
 * known-good number and aim the dialer at whoever the vendor guessed.
 */
function ReverseSearchCard({
  lead,
  onApplied,
}: {
  lead: Lead;
  onApplied: (phone: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "searching" | "done">("idle");
  const [candidates, setCandidates] = useState<ReverseSearchCandidate[]>([]);
  const [suppressed, setSuppressed] = useState(0);
  const [source, setSource] = useState<"provider" | "demo" | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  // "homeowner" / "policyholder" / "lead" — this control talks about the person
  // being looked up, so it has to use the workspace's own noun.
  const vocab = useVocabulary();

  // Reset when the rep moves to another lead — stale results next to a
  // different person's name is exactly how a wrong number gets dialed.
  useEffect(() => {
    setStatus("idle");
    setCandidates([]);
    setSuppressed(0);
    setErr(null);
    setSource(null);
  }, [lead.id]);

  // Cheap client-side guard so an obviously unsearchable lead doesn't spend a
  // metered vendor query. The server's hasSearchableIdentity() is the real
  // rule and is stricter; this only catches the empty case.
  const searchable = Boolean(
    (lead.address ?? "").trim() ||
      (lead.city ?? "").trim() ||
      (lead.zip ?? "").trim() ||
      `${lead.firstName ?? ""}${lead.lastName ?? ""}`.trim(),
  );

  async function run() {
    setStatus("searching");
    setErr(null);
    try {
      const res = await fetch("/api/leads/reverse-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        candidates?: ReverseSearchCandidate[];
        suppressed?: number;
        source?: "provider" | "demo";
        provider?: string | null;
        error?: string | null;
      };
      if (!res.ok) {
        setErr(json.error ?? "That lookup didn't go through.");
        setStatus("idle");
        return;
      }
      setCandidates(json.candidates ?? []);
      setSuppressed(json.suppressed ?? 0);
      setSource(json.source ?? null);
      setProvider(json.provider ?? null);
      // A vendor-side error still returns 200 with an empty list — surface it
      // so "found nothing" and "the lookup broke" don't look identical.
      setErr(json.error ?? null);
      setStatus("done");
    } catch {
      setErr("Couldn't reach the server.");
      setStatus("idle");
    }
  }

  async function apply(phone: string) {
    setApplying(phone);
    setErr(null);
    try {
      const res = await fetch("/api/leads/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: lead.id, phone }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Couldn't save that number to the lead.");
        return;
      }
      onApplied(phone);
      setStatus("idle");
      setCandidates([]);
    } catch {
      setErr("Network error while saving that number.");
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ScanSearch className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Reverse search</p>
          <p className="text-[11px] text-muted-foreground">
            Look up a number from this {vocab.leadNoun}&apos;s name &amp; address
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={status === "searching" || !searchable}
          onClick={run}
          title={
            searchable
              ? `Skip-trace this ${vocab.leadNoun} for a phone number`
              : `This ${vocab.leadNoun} has no name or address to search on`
          }
        >
          {status === "searching" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ScanSearch className="h-3.5 w-3.5" />
          )}
          {status === "done" ? "Search again" : "Search"}
        </Button>
      </div>

      {err && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-danger">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          {err}
        </p>
      )}

      {status === "done" && (
        <div className="mt-3 space-y-1.5">
          {source === "demo" && (
            <p className="text-[11px] text-warning">
              Demo result — no lookup provider is configured, so this is a reserved
              555 number, not a real listing.
            </p>
          )}
          {candidates.length === 0 && !err && (
            <p className="text-[11px] text-muted-foreground">
              No numbers found for this name and address.
            </p>
          )}
          {candidates.map((c) => (
            <div
              key={c.phone}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold tabular">
                  {formatPhone(c.phone)}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {[
                    LINE_TYPE_LABEL[c.lineType],
                    c.confidence != null ? `${c.confidence}% match` : null,
                    c.matchedName,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {c.isCurrent ? (
                <Badge tone="success">On file</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  disabled={applying !== null}
                  onClick={() => apply(c.phone)}
                  title={
                    lead.phone
                      ? `Replaces ${formatPhone(lead.phone)} on this ${vocab.leadNoun}`
                      : `Save this number to the ${vocab.leadNoun}`
                  }
                >
                  {applying === c.phone ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Use
                </Button>
              )}
            </div>
          ))}
          {suppressed > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {suppressed} result{suppressed === 1 ? "" : "s"} hidden — on your
              Do-Not-Call list.
            </p>
          )}
          {provider && source === "provider" && (
            <p className="text-[11px] text-muted-foreground">via {provider}</p>
          )}
        </div>
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
  canReverseSearch,
  onLeadPatched,
}: {
  lead: Lead;
  upNext: Lead[];
  fields: LeadFieldDef[];
  showCallHistory: boolean;
  canReverseSearch: boolean;
  onLeadPatched?: (leadId: string, patch: Partial<Lead>) => void;
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

        {canReverseSearch && (
          <ReverseSearchCard
            lead={lead}
            onApplied={(phone) => onLeadPatched?.(lead.id, { phone })}
          />
        )}

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
