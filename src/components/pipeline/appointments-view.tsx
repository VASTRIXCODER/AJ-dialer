"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  RotateCcw,
  Search,
  Sparkles,
  SlidersHorizontal,
  Star,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { OutcomeGrid } from "@/components/dialer/outcome-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/input";
import { Portal } from "@/components/ui/portal";
import {
  bucketOf,
  matchesFilters,
  organizeAppointments,
  type ApptBucket,
} from "@/lib/appointments-organize";
import type { AppointmentRow } from "@/lib/db/pipeline";
import type { CallOutcome } from "@/lib/types";
import { cn, formatPhone, initials } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The Appointments workspace. AI bookings arrive as proposals (approved=false)
// and sit in a "Needs review" lane until a human approves, edits, or routes them
// back to another disposition. Everything happens in centered dialogs so nothing
// is ever clipped by a card's overflow. List + calendar views, full filtering,
// bulk approve, density, and a saveable default view round it out.
// ─────────────────────────────────────────────────────────────────────────────

type Density = "comfortable" | "compact";
type SourceFilter = "all" | "ai" | "rep";
type SortKey = "smart" | "soonest" | "newest" | "name";
type ViewKey = "list" | "calendar";

export interface ApptPrefs {
  view?: ViewKey;
  density?: Density;
  source?: SourceFilter;
  sort?: SortKey;
}

const BUCKET_ORDER: ApptBucket[] = [
  "review",
  "overdue",
  "today",
  "tomorrow",
  "week",
  "later",
  "past",
  "cancelled",
];

const BUCKET_META: Record<
  ApptBucket,
  { label: string; hint: string; tone: "warning" | "danger" | "accent" | "primary" | "neutral" | "success" }
> = {
  review: { label: "Needs review", hint: "AI proposals awaiting your approval", tone: "warning" },
  overdue: { label: "Overdue", hint: "Past their time, not yet closed out", tone: "danger" },
  today: { label: "Today", hint: "Happening today", tone: "accent" },
  tomorrow: { label: "Tomorrow", hint: "Up next", tone: "accent" },
  week: { label: "This week", hint: "Within the next 7 days", tone: "primary" },
  later: { label: "Later", hint: "Further out or unscheduled", tone: "neutral" },
  past: { label: "Past", hint: "Completed or no-show", tone: "success" },
  cancelled: { label: "Cancelled", hint: "Called off", tone: "neutral" },
};

const STATUS_META: Record<
  string,
  { tone: "success" | "warning" | "danger" | "neutral" | "accent"; label: string }
> = {
  scheduled: { tone: "accent", label: "Scheduled" },
  completed: { tone: "success", label: "Completed" },
  no_show: { tone: "danger", label: "No-show" },
  rescheduled: { tone: "warning", label: "Rescheduled" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

const STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No-show" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancelled" },
];

// ── time helpers ─────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");

function whenLabel(a: AppointmentRow): string {
  // The human label is the agreed wording ("Tomorrow — Tue, Jun 23 at 6:00 PM");
  // prefer it, falling back to formatting the machine timestamp.
  if (a.scheduledLabel) return a.scheduledLabel;
  if (a.scheduledAt) {
    return new Date(a.scheduledAt).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return "No time set";
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AppointmentsView({
  appts,
  teamWide,
  reps,
  prefs,
}: {
  appts: AppointmentRow[];
  teamWide: boolean;
  reps: string[];
  prefs: ApptPrefs;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();

  const [view, setView] = useState<ViewKey>(prefs.view ?? "list");
  const [density, setDensity] = useState<Density>(prefs.density ?? "comfortable");
  const [source, setSource] = useState<SourceFilter>(prefs.source ?? "all");
  const [sort, setSort] = useState<SortKey>(prefs.sort ?? "smart");
  const [rep, setRep] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [active, setActive] = useState<AppointmentRow | null>(null);
  const [savedDefault, setSavedDefault] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const filters = useMemo(() => ({ source, rep, search }), [source, rep, search]);

  // KPIs reflect the whole pipeline (not the active filters).
  const kpi = useMemo(() => {
    let review = 0;
    let upcoming = 0;
    let completed = 0;
    let noShow = 0;
    for (const a of appts) {
      const b = bucketOf(a);
      if (b === "review") review += 1;
      if (b === "overdue" || b === "today" || b === "tomorrow" || b === "week" || b === "later")
        upcoming += 1;
      if (a.status === "completed") completed += 1;
      if (a.status === "no_show") noShow += 1;
    }
    const showRate = completed + noShow ? Math.round((completed / (completed + noShow)) * 100) : 0;
    return { review, upcoming, completed, showRate, total: appts.length };
  }, [appts]);

  // Buckets for the list view, re-sorted within each per the chosen sort key.
  const buckets = useMemo(() => {
    const organized = organizeAppointments(appts, filters);
    if (sort !== "smart") {
      const cmp = (a: AppointmentRow, b: AppointmentRow) => {
        if (sort === "name") return a.leadName.localeCompare(b.leadName);
        if (sort === "newest")
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        // soonest
        const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
        const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
        return ta - tb;
      };
      for (const k of BUCKET_ORDER) organized[k] = [...organized[k]].sort(cmp);
    }
    return organized;
  }, [appts, filters, sort]);

  const filtered = useMemo(() => appts.filter((a) => matchesFilters(a, filters)), [appts, filters]);
  const reviewItems = buckets.review;
  const matchCount = filtered.length;

  // ── actions ────────────────────────────────────────────────────────────────
  const post = useCallback(
    async (body: Record<string, unknown>, key: string): Promise<boolean> => {
      setBusyId(key);
      try {
        const res = await fetch("/api/pipeline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) return false;
        router.refresh();
        return true;
      } catch {
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  const approve = useCallback(
    (id: string) => post({ action: "appointment-approve", id }, id),
    [post],
  );
  const setStatus = useCallback(
    (id: string, status: string) => post({ action: "appointment", id, status }, id),
    [post],
  );
  const routeBack = useCallback(
    (leadId: string, outcome: CallOutcome) =>
      post({ action: "disposition", leadId, outcome }, leadId),
    [post],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectAllReview = useCallback(() => {
    setSelected((prev) => {
      const ids = reviewItems.map((a) => a.id);
      const allOn = ids.every((id) => prev.has(id));
      return allOn ? new Set() : new Set(ids);
    });
  }, [reviewItems]);

  const bulkApprove = useCallback(async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await post({ action: "appointment-bulk", ids, op: "approve" }, "bulk");
    if (ok) clearSelection();
  }, [selected, post, clearSelection]);

  const bulkRoute = useCallback(
    async (outcome: CallOutcome) => {
      const ids = [...selected];
      if (!ids.length) return;
      const ok = await post({ action: "appointment-bulk", ids, op: "route", outcome }, "bulk");
      if (ok) clearSelection();
    },
    [selected, post, clearSelection],
  );

  const saveDefault = useCallback(async () => {
    setSavedDefault(false);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferences: { appointments: { view, density, source, sort } } }),
      });
      if (res.ok) {
        setSavedDefault(true);
        setTimeout(() => setSavedDefault(false), 2200);
      }
    } catch {
      /* non-fatal */
    }
  }, [view, density, source, sort]);

  const rowApi: RowApi = {
    busyId,
    selected,
    teamWide,
    density,
    onToggle: toggleSelect,
    onApprove: approve,
    onOpen: setActive,
  };

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard
          label="Needs review"
          value={String(kpi.review)}
          sub={kpi.review ? "Awaiting approval" : "All caught up"}
          icon={Sparkles}
          accent={kpi.review ? "warning" : "success"}
        />
        <MetricCard label="Upcoming" value={String(kpi.upcoming)} sub="Scheduled ahead" icon={CalendarClock} accent="accent" />
        <MetricCard label="Completed" value={String(kpi.completed)} sub="Reviews held" icon={CalendarCheck} accent="success" />
        <MetricCard label="Show rate" value={`${kpi.showRate}%`} sub="Held vs no-show" icon={Star} accent="primary" />
      </div>

      {/* Toolbar */}
      <Toolbar
        view={view}
        setView={setView}
        density={density}
        setDensity={setDensity}
        source={source}
        setSource={setSource}
        sort={sort}
        setSort={setSort}
        rep={rep}
        setRep={setRep}
        reps={reps}
        teamWide={teamWide}
        search={search}
        setSearch={setSearch}
        onSaveDefault={saveDefault}
        savedDefault={savedDefault}
        matchCount={matchCount}
      />

      {/* Review callout (bulk approve) */}
      {reviewItems.length > 0 && (
        <ReviewCallout
          count={reviewItems.length}
          allSelected={reviewItems.every((a) => selected.has(a.id))}
          onSelectAll={selectAllReview}
        />
      )}

      {view === "list" ? (
        matchCount === 0 ? (
          <EmptyMatches onReset={() => { setSearch(""); setSource("all"); setRep("all"); }} />
        ) : (
          <div className="space-y-5">
            {BUCKET_ORDER.map((b) => {
              const list = buckets[b];
              if (!list.length) return null;
              const closed = b === "past" || b === "cancelled";
              return (
                <BucketSection
                  key={b}
                  bucket={b}
                  items={list}
                  api={rowApi}
                  collapsed={closed && !showClosed}
                  onToggleCollapsed={closed ? () => setShowClosed((v) => !v) : undefined}
                />
              );
            })}
          </div>
        )
      ) : (
        <CalendarView items={filtered} density={density} onOpen={setActive} />
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <BulkBar
            count={selected.size}
            busy={busyId === "bulk"}
            reduce={!!reduce}
            onApprove={bulkApprove}
            onRoute={bulkRoute}
            onClear={clearSelection}
          />
        )}
      </AnimatePresence>

      {/* Detail / review dialog */}
      <AnimatePresence>
        {active && (
          <DetailDialog
            key={active.id}
            appt={active}
            teamWide={teamWide}
            busy={busyId != null && (busyId === active.id || busyId === active.leadId)}
            reduce={!!reduce}
            onClose={() => setActive(null)}
            onApprove={async (id) => {
              if (await approve(id)) setActive(null);
            }}
            onSave={async (id, patch) => {
              if (await post({ action: "appointment-edit", id, ...patch }, id)) setActive(null);
            }}
            onStatus={async (id, status) => {
              if (await setStatus(id, status)) setActive(null);
            }}
            onRoute={async (leadId, outcome) => {
              if (await routeBack(leadId, outcome)) setActive(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
interface RowApi {
  busyId: string | null;
  selected: Set<string>;
  teamWide: boolean;
  density: Density;
  onToggle: (id: string) => void;
  onApprove: (id: string) => void;
  onOpen: (a: AppointmentRow) => void;
}

function Toolbar({
  view, setView, density, setDensity, source, setSource, sort, setSort,
  rep, setRep, reps, teamWide, search, setSearch, onSaveDefault, savedDefault, matchCount,
}: {
  view: ViewKey; setView: (v: ViewKey) => void;
  density: Density; setDensity: (d: Density) => void;
  source: SourceFilter; setSource: (s: SourceFilter) => void;
  sort: SortKey; setSort: (s: SortKey) => void;
  rep: string; setRep: (r: string) => void; reps: string[]; teamWide: boolean;
  search: string; setSearch: (s: string) => void;
  onSaveDefault: () => void; savedDefault: boolean; matchCount: number;
}) {
  const seg =
    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors";
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, or notes…"
            className="w-full rounded-xl border border-input bg-background/40 py-2.5 pl-9 pr-3 text-sm transition-all duration-200 placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          />
        </div>

        {/* Source segmented */}
        <div className="flex items-center rounded-xl border border-border/60 bg-surface/50 p-1">
          {(["all", "ai", "rep"] as SourceFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={cn(seg, source === s ? "bg-foreground text-background shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              {s === "all" ? "All" : s === "ai" ? "AI" : "Rep"}
            </button>
          ))}
        </div>

        {teamWide && reps.length > 0 && (
          <Select value={rep} onChange={(e) => setRep(e.target.value)} className="h-auto w-auto py-2 text-sm">
            <option value="all">All reps</option>
            {reps.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        )}

        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-auto w-auto py-2 text-sm"
          aria-label="Sort"
        >
          <option value="smart">Smart order</option>
          <option value="soonest">Soonest first</option>
          <option value="newest">Newest added</option>
          <option value="name">Name (A–Z)</option>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-xl border border-border/60 bg-surface/50 p-1">
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(seg, view === "list" ? "bg-foreground text-background shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> List
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={cn(seg, view === "calendar" ? "bg-foreground text-background shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              <CalendarDays className="h-3.5 w-3.5" /> Calendar
            </button>
          </div>

          {/* Density toggle */}
          <button
            type="button"
            onClick={() => setDensity(density === "comfortable" ? "compact" : "comfortable")}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-border/60 bg-surface/50 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            title="Toggle density"
          >
            {density === "comfortable" ? "Comfortable" : "Compact"}
          </button>

          <Button variant="outline" size="sm" onClick={onSaveDefault} className="gap-1.5">
            {savedDefault ? <Check className="h-3.5 w-3.5 text-success" /> : <Star className="h-3.5 w-3.5" />}
            {savedDefault ? "Saved" : "Save view"}
          </Button>
        </div>
      </div>
      <p className="mt-2 px-1 text-[11px] text-muted-foreground">
        {matchCount} {matchCount === 1 ? "appointment" : "appointments"} match
      </p>
    </Card>
  );
}

function ReviewCallout({
  count, allSelected, onSelectAll,
}: { count: number; allSelected: boolean; onSelectAll: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {count} AI {count === 1 ? "proposal" : "proposals"} awaiting review
        </p>
        <p className="text-xs text-muted-foreground">
          Approve to confirm the booking, edit the time, or route the lead back to another disposition.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onSelectAll} className="gap-1.5">
        <CheckCheck className="h-3.5 w-3.5" />
        {allSelected ? "Clear selection" : "Select all"}
      </Button>
    </div>
  );
}

function BucketSection({
  bucket, items, api, collapsed, onToggleCollapsed,
}: {
  bucket: ApptBucket;
  items: AppointmentRow[];
  api: RowApi;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const meta = BUCKET_META[bucket];
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggleCollapsed}
        disabled={!onToggleCollapsed}
        className={cn(
          "flex w-full items-center gap-2.5 border-b border-border/60 px-5 py-3.5 text-left",
          onToggleCollapsed && "transition-colors hover:bg-muted/40",
        )}
      >
        <Badge tone={meta.tone} className="shrink-0">{meta.label}</Badge>
        <span className="hidden text-xs text-muted-foreground sm:inline">{meta.hint}</span>
        <span className="ml-auto flex items-center gap-2 text-xs font-semibold tabular text-muted-foreground">
          {items.length}
          {onToggleCollapsed && (
            <ChevronRight className={cn("h-4 w-4 transition-transform", !collapsed && "rotate-90")} />
          )}
        </span>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border/60">
          {items.map((a) => (
            <ApptRow key={a.id} a={a} api={api} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ApptRow({ a, api }: { a: AppointmentRow; api: RowApi }) {
  const compact = api.density === "compact";
  const status = STATUS_META[a.status] ?? STATUS_META.scheduled;
  const isReview = !a.approved && a.status !== "completed" && a.status !== "no_show" && a.status !== "cancelled";
  const busy = api.busyId === a.id;
  const checked = api.selected.has(a.id);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => api.onOpen(a)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          api.onOpen(a);
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
        compact ? "px-4 py-2.5" : "px-5 py-3.5",
      )}
    >
      {isReview && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); api.onToggle(a.id); }}
          aria-label={checked ? "Deselect" : "Select"}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            checked ? "border-primary bg-primary text-white" : "border-border bg-surface hover:border-primary/60",
          )}
        >
          {checked && <Check className="h-3.5 w-3.5" />}
        </button>
      )}

      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl font-semibold",
          compact ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-xs",
          isReview ? "bg-warning/15 text-warning" : "bg-accent-soft text-accent",
        )}
      >
        {a.source === "ai" ? <Sparkles className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} /> : initials(a.leadName)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={cn("truncate font-semibold", compact && "text-sm")}>{a.leadName}</p>
          {a.source === "ai" && (
            <Badge tone="accent" className="hidden gap-1 sm:inline-flex">
              <Sparkles className="h-3 w-3" /> AI
            </Badge>
          )}
        </div>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" />
          {whenLabel(a)}
          {api.teamWide && a.repName && <span className="truncate">· {a.repName}</span>}
          {a.phone && <span className="hidden truncate md:inline">· {formatPhone(a.phone)}</span>}
        </p>
      </div>

      {isReview ? (
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="success" onClick={() => api.onApprove(a.id)} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Approve</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => api.onOpen(a)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        </div>
      ) : (
        <Badge tone={status.tone} className="shrink-0">{status.label}</Badge>
      )}
    </div>
  );
}

function BulkBar({
  count, busy, reduce, onApprove, onRoute, onClear,
}: {
  count: number; busy: boolean; reduce: boolean;
  onApprove: () => void; onRoute: (o: CallOutcome) => void; onClear: () => void;
}) {
  const [routing, setRouting] = useState(false);
  return (
    <Portal>
      <motion.div
        initial={reduce ? false : { y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { y: 80, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="fixed inset-x-0 bottom-5 z-[80] flex justify-center px-4"
      >
        <div className="glass flex items-center gap-2 rounded-2xl border border-border/60 p-2 pl-4 shadow-lift">
          <span className="text-sm font-semibold">{count} selected</span>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button size="sm" variant="success" onClick={onApprove} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            Approve all
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRouting((v) => !v)} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Route back
          </Button>
          <button
            type="button"
            onClick={onClear}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {routing && (
          <Portal>
            <div className="fixed inset-0 z-[101] flex items-end justify-center sm:items-center sm:p-4">
              <div className="absolute inset-0 bg-background/70 backdrop-blur-xl" onClick={() => setRouting(false)} />
              <div className="glass relative w-full max-w-md rounded-t-2xl border border-border/60 p-5 shadow-lift sm:rounded-2xl">
                <div className="mb-4">
                  <p className="text-base font-semibold">Route {count} back</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Re-file every selected lead under one disposition. This overrides the AI and updates reports.
                  </p>
                </div>
                <OutcomeGrid onSelect={(o) => { setRouting(false); onRoute(o); }} />
              </div>
            </div>
          </Portal>
        )}
      </motion.div>
    </Portal>
  );
}

// ── Calendar view (under development) ────────────────────────────────────────
function CalendarView({
  items,
}: { items: AppointmentRow[]; density: Density; onOpen: (a: AppointmentRow) => void }) {
  const scheduled = items.filter((a) => a.scheduledAt).length;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col items-center justify-center gap-5 px-6 py-20 text-center">
        <div className="relative">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
            <CalendarDays className="h-9 w-9 text-primary" />
          </div>
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-white">
            ✦
          </span>
        </div>

        <div className="max-w-sm space-y-1.5">
          <h3 className="text-lg font-semibold">Calendar view coming soon</h3>
          <p className="text-sm text-muted-foreground">
            We&apos;re building a monthly grid where you can see every scheduled appointment at a
            glance, drag to reschedule, and spot open slots — refined and ready shortly.
          </p>
        </div>

        {scheduled > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/50 px-4 py-2.5 text-sm">
            <CalendarClock className="h-4 w-4 shrink-0 text-accent" />
            <span>
              <span className="font-semibold">{scheduled}</span>{" "}
              {scheduled === 1 ? "appointment is" : "appointments are"} already timed and will
              appear here once the calendar is live.
            </span>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          In the meantime, use the <span className="font-semibold">List</span> view to manage and
          approve appointments.
        </p>
      </div>
    </Card>
  );
}

// ── Detail / review dialog ───────────────────────────────────────────────────
function DetailDialog({
  appt, teamWide, busy, reduce, onClose, onApprove, onSave, onStatus, onRoute,
}: {
  appt: AppointmentRow;
  teamWide: boolean;
  busy: boolean;
  reduce: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  onSave: (id: string, patch: { scheduledAt?: string | null; scheduledLabel?: string; notes?: string; approve?: boolean }) => void;
  onStatus: (id: string, status: string) => void;
  onRoute: (leadId: string, outcome: CallOutcome) => void;
}) {
  const isReview = !appt.approved && appt.status !== "completed" && appt.status !== "no_show" && appt.status !== "cancelled";
  const [when, setWhen] = useState(toLocalInput(appt.scheduledAt));
  const [notes, setNotes] = useState(appt.notes ?? "");
  const [status, setStatusValue] = useState(appt.status || "scheduled");
  const [routing, setRouting] = useState(false);

  const buildPatch = (approve: boolean) => {
    const patch: { scheduledAt?: string | null; scheduledLabel?: string; notes?: string; approve?: boolean } = {};
    const orig = toLocalInput(appt.scheduledAt);
    if (when !== orig) {
      if (when) {
        const d = new Date(when);
        // Store the naive wall-clock (no tz suffix) so it round-trips unshifted.
        patch.scheduledAt = when.length === 16 ? `${when}:00` : when;
        patch.scheduledLabel = d.toLocaleString("en-US", {
          weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        });
      } else {
        patch.scheduledAt = null;
      }
    }
    if (notes !== (appt.notes ?? "")) patch.notes = notes;
    if (approve) patch.approve = true;
    return patch;
  };

  const save = (approve: boolean) => {
    const patch = buildPatch(approve);
    if (Object.keys(patch).length === 0) {
      if (approve) onApprove(appt.id);
      else onClose();
      return;
    }
    onSave(appt.id, patch);
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-background/70 backdrop-blur-xl"
          onClick={onClose}
        />
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="glass relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border/60 shadow-lift sm:rounded-2xl"
        >
          {/* Header */}
          <div className="flex items-start gap-3 border-b border-border/60 p-5">
            <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-semibold", isReview ? "bg-warning/15 text-warning" : "bg-accent-soft text-accent")}>
              {appt.source === "ai" ? <Sparkles className="h-5 w-5" /> : initials(appt.leadName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-semibold">{appt.leadName}</h2>
                {appt.source === "ai" && (
                  <Badge tone="accent" className="gap-1"><Sparkles className="h-3 w-3" /> AI</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {isReview ? "AI proposal — review to confirm" : STATUS_META[appt.status]?.label ?? "Appointment"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {busy ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : routing ? (
            <div className="p-5">
              <button type="button" onClick={() => setRouting(false)} className="mb-3 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
              <p className="mb-1 text-base font-semibold">Route this lead back</p>
              <p className="mb-4 text-sm text-muted-foreground">
                Override the appointment and re-file the lead under another disposition.
              </p>
              {appt.leadId ? (
                <OutcomeGrid onSelect={(o) => onRoute(appt.leadId!, o)} />
              ) : (
                <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                  No lead is linked to this appointment, so it can&apos;t be re-dispositioned.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Context chips */}
              <div className="flex flex-wrap gap-2 px-5 pt-4">
                {appt.phone && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-medium">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" /> {formatPhone(appt.phone)}
                  </span>
                )}
                {appt.city && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-medium">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {appt.city}
                  </span>
                )}
                {teamWide && appt.repName && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-medium">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" /> {appt.repName}
                  </span>
                )}
              </div>

              {/* Editable fields */}
              <div className="space-y-4 p-5">
                <div>
                  <Label htmlFor="appt-when">When</Label>
                  <input
                    id="appt-when"
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background/40 px-3.5 py-2.5 text-sm transition-all duration-200 focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
                  />
                  {!when && appt.scheduledLabel && (
                    <p className="mt-1 text-xs text-muted-foreground">Current: {appt.scheduledLabel}</p>
                  )}
                </div>

                {!isReview && (
                  <div>
                    <Label htmlFor="appt-status">Status</Label>
                    <Select id="appt-status" value={status} onChange={(e) => setStatusValue(e.target.value)}>
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  </div>
                )}

                <div>
                  <Label htmlFor="appt-notes">Notes</Label>
                  <Textarea id="appt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add context for the rep handling this review…" />
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 p-4">
                <Button variant="ghost" size="sm" onClick={() => setRouting(true)} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" /> Route back
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  {isReview ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => save(false)}>Save edits</Button>
                      <Button variant="success" size="sm" onClick={() => save(true)} className="gap-1.5">
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                    </>
                  ) : (
                    <>
                      {status !== appt.status && (
                        <Button variant="outline" size="sm" onClick={() => onStatus(appt.id, status)}>
                          Update status
                        </Button>
                      )}
                      <Button variant="primary" size="sm" onClick={() => save(false)}>Save changes</Button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </Portal>
  );
}

function EmptyMatches({ onReset }: { onReset: () => void }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div>
        <p className="font-semibold">No appointments match</p>
        <p className="text-sm text-muted-foreground">Try clearing the search or filters.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onReset}>Reset filters</Button>
    </Card>
  );
}
