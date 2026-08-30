"use client";

import {
  Bot,
  FileText,
  Filter,
  Headphones,
  Loader2,
  Pause,
  Play,
  Search,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { EmptyState } from "@/components/shared/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import type {
  ArchiveCall,
  ArchiveChannel,
  ArchiveMedia,
  ArchivePage,
} from "@/lib/db/call-archive";
import { resolveOutcomeConfig } from "@/lib/status";
import type { CallOutcome } from "@/lib/types";
import {
  cn,
  formatClock,
  formatDay,
  formatDuration,
  formatPhone,
  initials,
  leadDisplayName,
} from "@/lib/utils";
import { CallDetailModal } from "./call-detail-modal";

const PAGE = 25;

interface Filters {
  q: string;
  channel: ArchiveChannel;
  outcome: string;
  rep: string;
  from: string;
  to: string;
  media: ArchiveMedia;
}

const BLANK: Filters = {
  q: "",
  channel: "all",
  outcome: "all",
  rep: "all",
  from: "",
  to: "",
  media: "all",
};

/** Date `n` days ago as YYYY-MM-DD, in the viewer's own timezone. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const RANGES: { label: string; days: number | null }[] = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 6 },
  { label: "30 days", days: 29 },
  { label: "All time", days: null },
];

export function CallArchive({
  reps = [],
  canSeeReps = false,
  /** Deep link: open this call as soon as the page mounts. */
  initialCallId = null,
}: {
  reps?: { id: string; name: string }[];
  canSeeReps?: boolean;
  initialCallId?: string | null;
}) {
  const vocab = useVocabulary();
  const outcomes = useMemo(() => resolveOutcomeConfig(vocab), [vocab]);

  const [filters, setFilters] = useState<Filters>(BLANK);
  // The text actually sent to the server. Debounced separately from the input so
  // typing stays instant while the archive isn't re-queried on every keystroke.
  const [term, setTerm] = useState("");
  const [page, setPage] = useState<ArchivePage | null>(null);
  const [calls, setCalls] = useState<ArchiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialCallId);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(filters.q.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  const queryString = useCallback(
    (offset: number) => {
      const p = new URLSearchParams();
      if (term) p.set("q", term);
      if (filters.channel !== "all") p.set("channel", filters.channel);
      if (filters.outcome !== "all") p.set("outcome", filters.outcome);
      if (filters.rep !== "all") p.set("rep", filters.rep);
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
      if (filters.media !== "all") p.set("media", filters.media);
      p.set("offset", String(offset));
      p.set("limit", String(PAGE));
      return p.toString();
    },
    [term, filters.channel, filters.outcome, filters.rep, filters.from, filters.to, filters.media],
  );

  // Re-query whenever the effective filters change. The request is aborted on
  // change so a slow early query can never land after a faster later one and
  // repaint the list with stale results.
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/calls/archive?${queryString(0)}`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((j: ArchivePage) => {
        setPage(j);
        setCalls(j.calls ?? []);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError("Couldn't load the archive.");
        void e;
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [queryString]);

  async function loadMore() {
    if (!page?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/calls/archive?${queryString(calls.length)}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as ArchivePage;
      setCalls((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...(j.calls ?? []).filter((c) => !seen.has(c.id))];
      });
      setPage(j);
    } catch {
      setError("Couldn't load more calls.");
    } finally {
      setLoadingMore(false);
    }
  }

  // One <audio> for the whole list: playing a second row stops the first, rather
  // than layering two recordings over each other.
  function togglePlay(call: ArchiveCall) {
    if (!call.recordingUrl) return;
    const el = audioRef.current;
    if (!el) return;
    if (playingId === call.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = call.recordingUrl;
    el.play().then(
      () => setPlayingId(call.id),
      () => setError("Couldn't play that recording."),
    );
  }

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const stop = () => setPlayingId(null);
    el.addEventListener("ended", stop);
    el.addEventListener("pause", stop);
    return () => {
      el.removeEventListener("ended", stop);
      el.removeEventListener("pause", stop);
    };
  }, []);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const activeCount =
    (filters.channel !== "all" ? 1 : 0) +
    (filters.outcome !== "all" ? 1 : 0) +
    (filters.rep !== "all" ? 1 : 0) +
    (filters.media !== "all" ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0);

  const activeRange = RANGES.find(
    (r) =>
      (r.days === null && !filters.from && !filters.to) ||
      (r.days !== null && filters.from === daysAgo(r.days) && !filters.to),
  );

  const openCall = openId ? calls.find((c) => c.id === openId) : undefined;

  return (
    <div className="space-y-4">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} className="hidden" preload="none" />

      {/* ── Search + filters ─────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <Input
              type="search"
              value={filters.q}
              onChange={(e) => set("q", e.target.value)}
              placeholder={`Search names, numbers, summaries, notes — and what was said on the call`}
              aria-label="Search calls, notes and transcripts"
              className="pl-9"
            />
            {loading && filters.q && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={cn(
              "flex h-[42px] items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors",
              activeCount > 0
                ? "border-primary/60 bg-primary-soft text-primary"
                : "border-border bg-background/40 text-muted-foreground hover:bg-muted",
            )}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeCount > 0 && (
              <Badge tone="primary" className="px-1.5 py-0">
                {activeCount}
              </Badge>
            )}
          </button>
        </div>

        {/* Date presets — always visible; they are the filter people reach for. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  from: r.days === null ? "" : daysAgo(r.days),
                  to: "",
                }))
              }
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                activeRange?.label === r.label
                  ? "border-primary/60 bg-primary-soft text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {r.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground tabular">
            {/* A null total means the count could not be taken — say so rather
                than printing the page size, which is what this used to do. */}
            {loading && !page
              ? "Searching…"
              : !page
                ? ""
                : page.total === null
                  ? "Couldn't count these calls"
                  : `${page.total.toLocaleString()} call${page.total === 1 ? "" : "s"}${
                      page.scope === "org" ? " · team-wide" : " · yours"
                    }`}
          </span>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 gap-3 border-t border-border/60 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Channel
              </span>
              <SelectMenu
                label="Channel"
                className="w-full"
                triggerClassName="w-full"
                value={filters.channel}
                onChange={(v) => set("channel", v as ArchiveChannel)}
                options={[
                  { value: "all", label: "All calls" },
                  { value: "ai", label: "AI agent" },
                  { value: "human", label: "Manual" },
                ]}
              />
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Outcome
              </span>
              <SelectMenu
                label="Outcome"
                className="w-full"
                triggerClassName="w-full"
                value={filters.outcome}
                onChange={(v) => set("outcome", v)}
                options={[
                  { value: "all", label: "Any outcome" },
                  ...(Object.keys(outcomes) as CallOutcome[]).map((k) => ({
                    value: k as string,
                    label: outcomes[k].label,
                  })),
                ]}
              />
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Has
              </span>
              <SelectMenu
                label="Has"
                className="w-full"
                triggerClassName="w-full"
                value={filters.media}
                onChange={(v) => set("media", v as ArchiveMedia)}
                options={[
                  { value: "all", label: "Anything" },
                  { value: "recording", label: "A recording" },
                  { value: "transcript", label: "A transcript" },
                ]}
              />
            </div>

            {canSeeReps && reps.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Rep
                </span>
                <SelectMenu
                  label="Rep"
                  className="w-full"
                  triggerClassName="w-full"
                  value={filters.rep}
                  onChange={(v) => set("rep", v)}
                  options={[
                    { value: "all", label: "Everyone" },
                    ...reps.map((r) => ({ value: r.id, label: r.name })),
                  ]}
                />
              </div>
            )}

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                From
              </span>
              <Input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => set("from", e.target.value)}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                To
              </span>
              <Input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => set("to", e.target.value)}
              />
            </label>

            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => setFilters(BLANK)}
                disabled={activeCount === 0 && !filters.q}
              >
                <X className="h-3.5 w-3.5" />
                Clear all
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {loading && calls.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-[74px] rounded-2xl" />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <EmptyState
          icon={Headphones}
          title={
            // "No calls recorded yet" is a lie when the archive simply can't be
            // read — a demo workspace has no database to search, and telling a
            // rep their team has never called is worse than saying nothing.
            page?.unavailable
              ? "The call archive can't be read right now"
              : term || activeCount > 0
                ? "Nothing matches those filters"
                : "No calls recorded yet"
          }
          description={
            page?.unavailable
              ? "Recordings and transcripts live in your workspace database. Either it isn't connected, or the search couldn't reach it — this is not the same as having no calls."
              : term || activeCount > 0
                ? "Try a shorter search, a wider date range, or clear the filters."
                : "Recordings and transcripts appear here as soon as your team starts dialing."
          }
          action={
            page?.unavailable || term || activeCount > 0
              ? undefined
              : { label: "Open the dialer", href: "/dialer" }
          }
        />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {calls.map((c) => {
            const cfg = c.outcome ? outcomes[c.outcome] : null;
            const isAI = c.channel === "ai";
            const playing = playingId === c.id;
            return (
              <div
                key={c.id}
                className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-3"
              >
                <button
                  type="button"
                  onClick={() => togglePlay(c)}
                  disabled={!c.hasRecording}
                  aria-label={
                    c.hasRecording
                      ? playing
                        ? "Pause recording"
                        : "Play recording"
                      : "No recording for this call"
                  }
                  title={c.hasRecording ? "Play the recording" : "No recording"}
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors",
                    !c.hasRecording
                      ? "cursor-not-allowed border-dashed border-border/60 text-ink-3"
                      : playing
                        ? "border-primary/60 bg-primary text-white"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>

                <button
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-semibold">
                      {leadDisplayName(c.leadName, c.phone, vocab.leadNoun)}
                    </span>
                    <Badge tone={isAI ? "accent" : "neutral"} className="gap-1">
                      {isAI ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                      {isAI ? "AI" : "Manual"}
                    </Badge>
                    {cfg && <Badge tone={cfg.tone} icon={cfg.icon}>{cfg.label}</Badge>}
                    {c.hasTranscript && (
                      <span
                        title="Has a transcript"
                        className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                      >
                        <FileText className="h-3 w-3" />
                        Transcript
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground tabular">
                    {formatDay(c.startedAt)} · {formatClock(c.startedAt)}
                    {c.durationSec ? ` · ${formatDuration(c.durationSec)}` : ""}
                    {c.phone ? ` · ${formatPhone(c.phone)}` : ""}
                  </p>
                  {/* Why this row matched — without it a transcript search is a
                      list of names you have to open one by one to understand. */}
                  {c.transcriptSnippet && (
                    <p className="mt-1 line-clamp-2 rounded-lg bg-muted/60 px-2 py-1 text-xs italic text-muted-foreground">
                      {c.transcriptSnippet}
                    </p>
                  )}
                </button>

                <div className="flex shrink-0 items-center gap-3">
                  {c.repName && (
                    <span className="hidden items-center gap-1.5 sm:flex">
                      <Avatar initials={initials(c.repName)} seed={c.repName} size="xs" />
                      <span className="max-w-[110px] truncate text-xs text-muted-foreground">
                        {c.repName}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Open
                  </button>
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-center gap-3 p-4">
            {page?.hasMore ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                Load more
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                All {calls.length.toLocaleString()} shown
              </span>
            )}
          </div>
        </div>
      )}

      {openId && (
        <CallDetailModal
          key={openId}
          callId={openId}
          preview={openCall}
          highlightTerm={term}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
