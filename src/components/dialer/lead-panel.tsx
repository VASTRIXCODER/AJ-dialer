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
  Copy,
  ExternalLink,
  FileText,
  Headphones,
  Loader2,
  Mail,
  MapPin,
  NotebookPen,
  Phone,
  PhoneCall,
  ScanSearch,
  ShieldAlert,
  Search,
  Users,
  Sun,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CallDetailModal } from "@/components/calls/call-detail-modal";
import { useVocabulary } from "@/components/layout/vocabulary";
import { truePeopleSearchUrl } from "@/lib/leads/people-search-url";
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
  isValidPhone,
  normalizePhone,
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
  reverseSearchConfigured = false,
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
  /** An automated skip-trace provider is set. False ⇒ the button opens
   *  TruePeopleSearch in a tab (no key, no server call). */
  reverseSearchConfigured?: boolean;
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
          reverseSearchConfigured={reverseSearchConfigured}
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

/** Why a lookup came back empty. "blocked" and "no_results" get deliberately
 *  different treatment — see the note on ReverseSearchResult.pageState. */
type PageState = "results" | "no_results" | "blocked" | "paywalled";

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
  const [pageState, setPageState] = useState<PageState>("results");
  const [note, setNote] = useState<string | null>(null);
  const [configProblem, setConfigProblem] = useState<string | null>(null);
  const [searchUrl, setSearchUrl] = useState<string | null>(null);
  /** Number typed in by hand after opening the page in a real browser. */
  const [manual, setManual] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  /** The candidate now loaded onto the lead (auto or by click) — drives the
   *  "ready to dial" banner and marks which row is live. */
  const [appliedPhone, setAppliedPhone] = useState<string | null>(null);
  // Leads already auto-searched this session, so scrolling back to one doesn't
  // spend a second lookup on it.
  const searchedRef = useRef<Set<string>>(new Set());
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
    setPageState("results");
    setNote(null);
    setConfigProblem(null);
    setSearchUrl(null);
    setManual("");
    setAppliedPhone(null);
  }, [lead.id]);

  // No dialable number on file — the case this feature exists for, so the
  // button goes solid instead of outline to call it out.
  const needsNumber = !isValidPhone(lead.phone ?? "");

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
        pageState?: PageState;
        note?: string | null;
        configProblem?: string | null;
        searchUrl?: string | null;
      };
      if (!res.ok) {
        setErr(json.error ?? "That lookup didn't go through.");
        setStatus("idle");
        return;
      }
      const cands = json.candidates ?? [];
      setCandidates(cands);
      setSuppressed(json.suppressed ?? 0);
      setSource(json.source ?? null);
      setProvider(json.provider ?? null);
      setPageState(json.pageState ?? "results");
      setNote(json.note ?? null);
      setConfigProblem(json.configProblem ?? null);
      setSearchUrl(json.searchUrl ?? null);
      // A vendor-side error still returns 200 with an empty list — surface it
      // so "found nothing" and "the lookup broke" don't look identical.
      setErr(json.error ?? null);
      setStatus("done");
      // Auto-load the best candidate (the server returns them best-first) so
      // the number is on the lead and dialable without a click — the whole
      // point of the automated mode. The others stay listed to switch to, and
      // there's an Undo, so a wrong top-pick is one click to fix rather than a
      // silent overwrite. Only auto-applies a real provider hit, never a demo
      // 555 number.
      if (cands.length && json.source === "provider") void apply(cands[0].phone);
    } catch {
      setErr("Couldn't reach the server.");
      setStatus("idle");
    }
  }

  async function apply(raw: string) {
    // Normalize BEFORE both the write and the local patch: a hand-typed
    // "(559) 555-0143" must land on the lead as E.164 like every other number,
    // and the card must show what was actually stored, not what was typed.
    const phone = normalizePhone(raw) || raw;
    setApplying(raw);
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
      setAppliedPhone(phone);
      // Candidates stay on screen so the rep can switch to another; the applied
      // one is marked in the list rather than the list being cleared.
    } catch {
      setErr("Network error while saving that number.");
    } finally {
      setApplying(null);
    }
  }

  // Background auto-lookup: a focused lead with no dialable number gets a
  // search fired automatically, so the number is found and loaded with the rep
  // doing nothing. Bounded to the case that needs it — no number to overwrite,
  // something to search on, once per lead per session — so it can't quietly
  // burn a lookup on every lead in a queue that already has numbers.
  useEffect(() => {
    if (!needsNumber || !searchable) return;
    if (searchedRef.current.has(lead.id)) return;
    searchedRef.current.add(lead.id);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, needsNumber, searchable]);

  return (
    <div className="mt-3">
      {/* A full-width, plainly-labelled button rather than a bordered box with
          a sentence of explanation: this column is ~280px wide, where that
          prose wrapped to six lines and squeezed the control into a corner
          nobody found. The label is the feature's NAME — it read "Search"
          before, which is indistinguishable from the dialer's other search
          affordances. Promoted to a solid button when the lead has no number
          on file, since that is exactly when this is the next thing to do. */}
      <Button
        size="sm"
        variant={needsNumber ? "primary" : "outline"}
        className="w-full gap-1.5"
        disabled={status === "searching" || !searchable}
        onClick={run}
        title={
          searchable
            ? `Look up a phone number from this ${vocab.leadNoun}'s name and address`
            : `This ${vocab.leadNoun} has no name or address to search on`
        }
      >
        {status === "searching" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ScanSearch className="h-3.5 w-3.5" />
        )}
        {status === "searching"
          ? "Finding a number…"
          : status === "done"
            ? "Look up another number"
            : "Reverse search"}
      </Button>

      {err && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-danger">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          {err}
        </p>
      )}

      {status === "done" && (
        <div className="mt-3 space-y-1.5">
          {/* Auto-loaded onto the lead — the number is on the card and the
              dialer will dial it. Shown prominently, with Undo, so the rep can
              see what happened and reverse a wrong pick in one click. */}
          {appliedPhone && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-2.5 py-1.5">
              <PhoneCall className="h-3.5 w-3.5 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold tabular text-success">
                  {formatPhone(appliedPhone)}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">Loaded — ready to dial</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onApplied("");
                  setAppliedPhone(null);
                }}
                disabled={applying !== null}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                title="Clear the number that was loaded onto this lead"
              >
                Undo
              </button>
            </div>
          )}
          {/* A half-configured provider used to produce the same "nothing is
              configured" line as an unconfigured one, which reads as the
              feature being broken. Say which variable is missing. */}
          {source === "demo" && (
            <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>
                <strong>Demo result — not a real listing.</strong> This is a
                reserved 555 number.{" "}
                {configProblem ??
                  "Set REVERSE_SEARCH_PROVIDER (whitepages, ekata, endato or batchdata) to run real lookups."}
              </span>
            </p>
          )}
          {/* A bot challenge and a genuine no-listing look identical if both
              render as "no numbers found" — and the first one silently reads
              as the second, which is how a scraper dies unnoticed. Blocked and
              paywalled get their own loud, differently-coloured treatment. */}
          {candidates.length === 0 && !err && pageState === "blocked" && (
            <p className="flex items-start gap-1.5 rounded-lg bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
              <ShieldAlert className="mt-px h-3 w-3 shrink-0" />
              <span>
                <strong>The site blocked the automatic lookup.</strong>{" "}
                {note ?? "It served a bot check instead of results."} This is not a
                “no listing” — open it in your browser below, where it isn’t
                blocked, and paste the number.
              </span>
            </p>
          )}
          {candidates.length === 0 && !err && pageState === "paywalled" && (
            <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>
                <strong>Numbers are hidden behind a paywall.</strong>{" "}
                {note ?? "The listing exists but its numbers require an account."}
              </span>
            </p>
          )}
          {candidates.length === 0 && !err && pageState === "no_results" && (
            <p className="text-[11px] text-muted-foreground">
              {note ?? `No numbers listed for this ${vocab.leadNoun}'s name and address.`}
            </p>
          )}
          {/* The auto-loaded number shows in the banner above; this lists the
              OTHER matches as one-click alternatives, since a skip trace often
              returns several and the top pick isn't always the right person. */}
          {candidates.some((c) => c.phone !== appliedPhone) && (
            <p className="pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {appliedPhone ? "Or use a different number" : "Matches"}
            </p>
          )}
          {candidates
            .filter((c) => c.phone !== appliedPhone)
            .map((c) => (
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
                    title={`Load this number onto the ${vocab.leadNoun} instead`}
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
          {/* When the automated read comes back empty — blocked, paywalled or
              genuinely nothing — the rep's OWN browser is the thing that isn't
              being challenged: real IP, real session, already trusted. Handing
              over the exact page beats any amount of effort spent trying to
              look less like a robot, and the input closes the loop so they
              never leave the dialer to save what they read. */}
          {candidates.length === 0 && searchUrl && (
            <div className="space-y-1.5 rounded-lg border border-border/70 bg-background/60 p-2">
              <a
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                Open this search in your browser
              </a>
              <p className="text-[11px] text-muted-foreground">
                Your browser isn&apos;t blocked the way the server is. Read the
                number off the page and put it here:
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="(559) 555-0143"
                  inputMode="tel"
                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs tabular outline-none focus-visible:border-primary/50"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 px-2"
                  disabled={applying !== null || digitsOnly(manual).length < 10}
                  onClick={() => apply(manual)}
                >
                  {applying === manual ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          )}
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

/**
 * Zero-config reverse lookup — no API key, no provider, no server call for the
 * search itself. Opens TruePeopleSearch in a new tab, pre-filled with the
 * lead's address, and takes the number the rep reads off it back onto the lead.
 *
 * The app can't read the other tab's contents (same-origin policy — no page can
 * read another site's tab), so the rep types the one number in. That's the
 * whole trade for needing nothing configured: the browser does the looking, the
 * human does the copying, the dialer saves the result.
 *
 * The address is shown with a Copy button as a backstop: if TruePeopleSearch
 * ever renames its URL params and the deep link lands on the home page instead
 * of results, the rep pastes the address into the site's own search and the
 * feature still works.
 */
function ManualLookupCard({
  lead,
  onApplied,
}: {
  lead: Lead;
  onApplied: (phone: string) => void;
}) {
  const vocab = useVocabulary();
  const [opened, setOpened] = useState(false);
  const [manual, setManual] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fresh lead ⇒ fresh state, so a number typed for one homeowner can't be
  // saved onto the next one after a queue advance.
  useEffect(() => {
    setOpened(false);
    setManual("");
    setCopied(false);
    setErr(null);
  }, [lead.id]);

  const url = truePeopleSearchUrl(lead);
  const address = formatAddress(lead);
  const needsNumber = !isValidPhone(lead.phone ?? "");

  function openTab() {
    if (!url) return;
    // Triggered by a real click, so the popup blocker allows it. noopener keeps
    // the people-search tab from being able to script back into the dialer.
    window.open(url, "_blank", "noopener,noreferrer");
    setOpened(true);
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard
      ?.writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  async function save() {
    const phone = normalizePhone(manual) || manual;
    setSaving(true);
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
      setManual("");
      setOpened(false);
    } catch {
      setErr("Network error while saving that number.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3">
      <Button
        size="sm"
        variant={needsNumber ? "primary" : "outline"}
        className="w-full gap-1.5"
        disabled={!url}
        onClick={openTab}
        title={
          url
            ? `Open TruePeopleSearch for this ${vocab.leadNoun} in a new tab`
            : `This ${vocab.leadNoun} has no name or address to search on`
        }
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Look up number on TruePeopleSearch
      </Button>

      {opened && (
        <div className="mt-2 space-y-2 rounded-lg border border-border/70 bg-muted/30 p-2.5">
          <p className="text-[11px] text-muted-foreground">
            Opened in a new tab. Read the number off the page and paste it here —
            it saves straight onto the {vocab.leadNoun}.
          </p>
          <div className="flex items-center gap-1.5">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="(559) 555-0143"
              inputMode="tel"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && digitsOnly(manual).length >= 10 && !saving) save();
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs tabular outline-none focus-visible:border-primary/50"
            />
            <Button
              size="sm"
              variant="outline"
              className="gap-1 px-2"
              disabled={saving || digitsOnly(manual).length < 10}
              onClick={save}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </Button>
          </div>
          {err && (
            <p className="flex items-start gap-1.5 text-[11px] text-danger">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              {err}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <button
              type="button"
              onClick={openTab}
              className="font-medium text-primary hover:underline"
            >
              Reopen tab
            </button>
            {address && (
              <button
                type="button"
                onClick={copyAddress}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                title="Copy the address to paste into the site's own search, if the page didn't pre-fill"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy address"}
              </button>
            )}
          </div>
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
  reverseSearchConfigured,
  onLeadPatched,
}: {
  lead: Lead;
  upNext: Lead[];
  fields: LeadFieldDef[];
  showCallHistory: boolean;
  canReverseSearch: boolean;
  reverseSearchConfigured: boolean;
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
            {/* An empty phone rendered as a blank line, which read as a layout
                bug rather than as missing data — and gave no hint that the
                reverse-search button below is what fixes it. */}
            <p
              className={cn(
                "truncate text-sm tabular",
                isValidPhone(lead.phone ?? "")
                  ? "text-muted-foreground"
                  : "italic text-warning",
              )}
            >
              {isValidPhone(lead.phone ?? "")
                ? formatPhone(lead.phone)
                : "No number on file"}
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

        {/* Directly under the number it replaces — this used to sit below the
            address and provider rows, ~215px down, which is not where anyone
            looks when they notice the phone is missing or dead.

            Two modes: with an automated provider set, the server does the
            lookup (ReverseSearchCard). With none — the zero-config default —
            the button just opens TruePeopleSearch in a tab and the rep types
            the number back (ManualLookupCard). No key, no server call. */}
        {canReverseSearch &&
          (reverseSearchConfigured ? (
            <ReverseSearchCard
              lead={lead}
              onApplied={(phone) => onLeadPatched?.(lead.id, { phone })}
            />
          ) : (
            <ManualLookupCard
              lead={lead}
              onApplied={(phone) => onLeadPatched?.(lead.id, { phone })}
            />
          ))}

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
