"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Loader2,
  MailWarning,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { OutcomeGrid } from "@/components/dialer/outcome-grid";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Portal } from "@/components/ui/portal";
import { bucketOf, matchesFilters, organizeAppointments } from "@/lib/appointments-organize";
import {
  addDays,
  addMonths,
  formatDayLabel,
  formatMonthLabel,
  parseFloating,
  startOfDay,
  startOfWeek,
  toFloatingString,
  weekDays,
} from "@/lib/appointments/time";
import type { AppointmentRow } from "@/lib/db/pipeline";
import type { CallOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppointmentDialog, type AppointmentPatch, type CreateDraft, type RepOption } from "./appointment-dialog";
import { CalendarMonth } from "./calendar-month";
import { CalendarWeek } from "./calendar-week";
import { BucketSection, type ListApi, ReviewCallout } from "./list-view";
import {
  type ApptAccess,
  type ApptPrefs,
  BUCKET_ORDER,
  type Density,
  type SortKey,
  type SourceFilter,
  type ViewKey,
} from "./shared";
import { useAppointmentDrag } from "./use-appointment-drag";

// ─────────────────────────────────────────────────────────────────────────────
// The appointments workspace. Four views over one dataset:
//
//   List   — triage. AI proposals awaiting approval, then overdue / today / next.
//   Month  — the shape of the month. Drag a review to another day.
//   Week   — the working view. Drag to a time, drag the edge to change how long.
//   Day    — one column, same grid.
//
// The list is where you WORK; the calendar is where you PLAN. The old tab had
// only the first, and a card promising the second "soon".
//
// Access is two plain booleans resolved on the server from permissions, prop-
// drilled like everything else here (there is no client permission context).
// Without `canManage` the whole surface is read-only: no drag, no create, no
// edit — see the 7.2 gate in /api/pipeline and src/lib/db/appointments.ts, which
// are what actually enforce it. This just stops us showing buttons that 403.
// ─────────────────────────────────────────────────────────────────────────────

export interface FailedNotice {
  /** The outbox row's id — what "Retry" re-queues. */
  id: string;
  /** The appointment it was about, so the dialog can find its own failure. */
  appointmentId: string | null;
  leadName: string;
  lastError: string;
  attempts: number;
}

export function AppointmentsWorkspace({
  appts,
  access,
  reps,
  repOptions,
  prefs,
  failed,
}: {
  appts: AppointmentRow[];
  access: ApptAccess;
  /** Rep display names, for the filter dropdown. */
  reps: string[];
  /** Rep id → name, for the assignee selector. */
  repOptions: RepOption[];
  prefs: ApptPrefs;
  failed: FailedNotice[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const reduce = useReducedMotion();

  // The URL wins over saved prefs, so a shared link opens the same screen the
  // sender was looking at. (Same idea as the shareable disposition filters.)
  const urlView = params.get("v") as ViewKey | null;
  const urlDate = params.get("d");

  const [view, setView] = useState<ViewKey>(urlView ?? prefs.view ?? "list");
  const [anchor, setAnchor] = useState<Date>(() => {
    const d = urlDate ? parseFloating(`${urlDate}T00:00:00`) : null;
    return d ?? startOfDay(new Date());
  });
  const [density, setDensity] = useState<Density>(prefs.density ?? "comfortable");
  const [source, setSource] = useState<SourceFilter>(prefs.source ?? "all");
  const [sort, setSort] = useState<SortKey>(prefs.sort ?? "smart");
  const [rep, setRep] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [active, setActive] = useState<AppointmentRow | null>(null);
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [savedDefault, setSavedDefault] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState("");

  const filters = useMemo(() => ({ source, rep, search }), [source, rep, search]);
  const filtered = useMemo(() => appts.filter((a) => matchesFilters(a, filters)), [appts, filters]);

  // KPIs describe the whole pipeline, not the current filter — a number that
  // moves when you type in a search box isn't a KPI.
  const kpi = useMemo(() => {
    let review = 0;
    let overdue = 0;
    let upcoming = 0;
    let completed = 0;
    let noShow = 0;
    for (const a of appts) {
      const b = bucketOf(a);
      if (b === "review") review += 1;
      // Overdue is counted on its own and kept OUT of "upcoming". It used to be
      // folded in, so an appointment whose time had already passed was reported
      // under the caption "Scheduled ahead" — the one bucket that most needs
      // someone to act on it was hidden inside the number that says nothing
      // needs doing yet.
      if (b === "overdue") overdue += 1;
      if (b === "today" || b === "tomorrow" || b === "week" || b === "later") upcoming += 1;
      if (a.status === "completed") completed += 1;
      if (a.status === "no_show") noShow += 1;
    }
    const showRate = completed + noShow ? Math.round((completed / (completed + noShow)) * 100) : 0;
    return { review, overdue, upcoming, completed, showRate };
  }, [appts]);

  const buckets = useMemo(() => {
    const organized = organizeAppointments(appts, filters);
    if (sort !== "smart") {
      const cmp = (a: AppointmentRow, b: AppointmentRow) => {
        if (sort === "name") return a.leadName.localeCompare(b.leadName);
        if (sort === "newest")
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        const ta = parseFloating(a.scheduledAt)?.getTime() ?? Infinity;
        const tb = parseFloating(b.scheduledAt)?.getTime() ?? Infinity;
        return ta - tb;
      };
      for (const k of BUCKET_ORDER) organized[k] = [...organized[k]].sort(cmp);
    }
    return organized;
  }, [appts, filters, sort]);

  const reviewItems = buckets.review;

  // ── mutations ──────────────────────────────────────────────────────────────
  const post = useCallback(
    async (body: Record<string, unknown>, key: string): Promise<boolean> => {
      setBusyId(key);
      setError("");
      try {
        const res = await fetch("/api/pipeline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) {
          setError(j.error ?? "That didn't work. Try again.");
          return false;
        }
        router.refresh();
        return true;
      } catch {
        setError("Network error.");
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

  // Drag commits straight to the DB — no confirm step. A misdrop is one drag back,
  // and a modal after every drag would make the calendar miserable to use.
  const commitDrag = useCallback(
    (id: string, scheduledAt: string, durationMin: number) => {
      void post({ action: "appointment-reschedule", id, scheduledAt, durationMin }, id);
    },
    [post],
  );

  const drag = useAppointmentDrag({
    appts: filtered,
    enabled: access.canManage,
    onCommit: commitDrag,
  });

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
      return ids.every((id) => prev.has(id)) ? new Set() : new Set(ids);
    });
  }, [reviewItems]);

  const bulkApprove = useCallback(async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (await post({ action: "appointment-bulk", ids, op: "approve" }, "bulk")) clearSelection();
  }, [selected, post, clearSelection]);

  const bulkRoute = useCallback(
    async (outcome: CallOutcome) => {
      const ids = [...selected];
      if (!ids.length) return;
      if (await post({ action: "appointment-bulk", ids, op: "route", outcome }, "bulk"))
        clearSelection();
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

  // ── navigation ─────────────────────────────────────────────────────────────
  const step = useCallback(
    (dir: -1 | 1) => {
      setAnchor((a) =>
        view === "month" ? addMonths(a, dir) : addDays(a, dir * (view === "week" ? 7 : 1)),
      );
    },
    [view],
  );

  const calendarDays = useMemo(
    () => (view === "week" ? weekDays(anchor) : [startOfDay(anchor)]),
    [view, anchor],
  );

  const rangeLabel =
    view === "month"
      ? formatMonthLabel(anchor)
      : view === "day"
        ? formatDayLabel(anchor)
        : `${formatDayLabel(startOfWeek(anchor))} – ${formatDayLabel(addDays(startOfWeek(anchor), 6))}`;

  const openCreate = useCallback((start: Date) => {
    setActive(null);
    setDraft({ scheduledAt: toFloatingString(start) });
  }, []);

  const listApi: ListApi = {
    busyId,
    selected,
    access,
    density,
    onToggle: toggleSelect,
    onApprove: approve,
    onOpen: setActive,
  };

  const isCalendar = view !== "list";
  // Appointments the AI agreed to ("next week") but never pinned to a time. They
  // cannot be drawn on a grid, so a calendar-only user would never see them —
  // which is exactly how a booking gets quietly lost.
  const unscheduled = useMemo(
    () =>
      filtered.filter(
        (a) => !a.scheduledAt && a.status !== "cancelled" && a.status !== "completed",
      ),
    [filtered],
  );

  return (
    <div className="space-y-6">
      {failed.length > 0 && access.canManage && (
        <FailedBanner
          failed={failed}
          busy={busyId === "retry"}
          onRetry={async (id) => {
            await post({ action: "notification-retry", id }, "retry");
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard
          label="Needs review"
          value={String(kpi.review)}
          // "All caught up" was a claim about the whole workspace made by a tile
          // that only ever counted one bucket — it read as reassurance while
          // appointments sat overdue two tiles away. The caption now says only
          // what this number actually measures.
          sub={kpi.review ? "Awaiting approval" : "None waiting"}
          icon={Sparkles}
          accent={kpi.review ? "warning" : "success"}
        />
        <MetricCard
          label="Upcoming"
          value={String(kpi.upcoming)}
          sub={
            kpi.overdue
              ? `${kpi.overdue} already overdue`
              : "Scheduled ahead"
          }
          icon={CalendarClock}
          accent={kpi.overdue ? "warning" : "accent"}
        />
        <MetricCard
          label="Completed"
          value={String(kpi.completed)}
          sub="Reviews held"
          icon={CalendarCheck}
          accent="success"
        />
        <MetricCard
          label="Show rate"
          value={`${kpi.showRate}%`}
          sub="Held vs no-show"
          icon={Star}
          accent="primary"
        />
      </div>

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
        access={access}
        search={search}
        setSearch={setSearch}
        onSaveDefault={saveDefault}
        savedDefault={savedDefault}
        matchCount={filtered.length}
        rangeLabel={rangeLabel}
        onStep={step}
        onToday={() => setAnchor(startOfDay(new Date()))}
        onCreate={() => openCreate(defaultSlot())}
      />

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      {reviewItems.length > 0 && access.canManage && (
        <ReviewCallout
          count={reviewItems.length}
          allSelected={reviewItems.every((a) => selected.has(a.id))}
          onSelectAll={selectAllReview}
        />
      )}

      {view === "list" ? (
        filtered.length === 0 ? (
          <EmptyMatches
            onReset={() => {
              setSearch("");
              setSource("all");
              setRep("all");
            }}
          />
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
                  api={listApi}
                  collapsed={closed && !showClosed}
                  onToggleCollapsed={closed ? () => setShowClosed((v) => !v) : undefined}
                />
              );
            })}
          </div>
        )
      ) : view === "month" ? (
        <CalendarMonth
          anchor={anchor}
          appts={filtered}
          access={access}
          preview={drag.preview}
          onBeginDrag={drag.begin}
          registerHitTest={drag.registerHitTest}
          didDrag={drag.didDrag}
          onOpen={setActive}
          onCreate={openCreate}
        />
      ) : (
        <CalendarWeek
          days={calendarDays}
          appts={filtered}
          access={access}
          preview={drag.preview}
          onBeginDrag={drag.begin}
          registerHitTest={drag.registerHitTest}
          didDrag={drag.didDrag}
          onOpen={setActive}
          onCreate={openCreate}
        />
      )}

      {isCalendar && unscheduled.length > 0 && <UnscheduledRail items={unscheduled} onOpen={setActive} />}

      <AnimatePresence>
        {selected.size > 0 && access.canManage && (
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

      <AnimatePresence>
        {(active || draft) && (
          <AppointmentDialog
            key={active?.id ?? "new"}
            appt={active}
            draft={draft}
            siblings={appts}
            access={access}
            reps={repOptions}
            busy={busyId != null && (busyId === active?.id || busyId === active?.leadId)}
            onClose={() => {
              setActive(null);
              setDraft(null);
            }}
            onCreate={async (input) => {
              if (await post({ action: "appointment-create", ...input }, "new")) setDraft(null);
            }}
            onSave={async (id, patch: AppointmentPatch) => {
              if (await post({ action: "appointment-edit", id, ...patch }, id)) setActive(null);
            }}
            onApprove={async (id) => {
              if (await approve(id)) setActive(null);
            }}
            onStatus={async (id, status) => {
              if (await post({ action: "appointment", id, status }, id)) setActive(null);
            }}
            onCancel={async (id, reason) => {
              if (await post({ action: "appointment-cancel", id, reason }, id)) setActive(null);
            }}
            onDelete={async (id) => {
              if (await post({ action: "appointment-delete", id }, id)) setActive(null);
            }}
            onRoute={async (leadId, outcome) => {
              if (await post({ action: "disposition", leadId, outcome }, leadId)) setActive(null);
            }}
            onRetryNotification={async (id) => {
              const target = failed.find((f) => f.appointmentId === id);
              if (target) await post({ action: "notification-retry", id: target.id }, "retry");
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Next hour, on the hour — the sane default for "New appointment". */
function defaultSlot(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
function Toolbar({
  view,
  setView,
  density,
  setDensity,
  source,
  setSource,
  sort,
  setSort,
  rep,
  setRep,
  reps,
  access,
  search,
  setSearch,
  onSaveDefault,
  savedDefault,
  matchCount,
  rangeLabel,
  onStep,
  onToday,
  onCreate,
}: {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  density: Density;
  setDensity: (d: Density) => void;
  source: SourceFilter;
  setSource: (s: SourceFilter) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  rep: string;
  setRep: (r: string) => void;
  reps: string[];
  access: ApptAccess;
  search: string;
  setSearch: (s: string) => void;
  onSaveDefault: () => void;
  savedDefault: boolean;
  matchCount: number;
  rangeLabel: string;
  onStep: (dir: -1 | 1) => void;
  onToday: () => void;
  onCreate: () => void;
}) {
  const seg =
    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors";
  const on = "bg-foreground text-background shadow-soft";
  const off = "text-muted-foreground hover:text-foreground";
  const isCalendar = view !== "list";

  const VIEWS: { key: ViewKey; label: string; icon: typeof CalendarDays }[] = [
    { key: "list", label: "List", icon: SlidersHorizontal },
    { key: "month", label: "Month", icon: CalendarDays },
    { key: "week", label: "Week", icon: CalendarRange },
    { key: "day", label: "Day", icon: Columns3 },
  ];

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2.5">
        {isCalendar ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onStep(-1)}
              aria-label="Previous"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onStep(1)}
              aria-label="Next"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <Button variant="outline" size="sm" onClick={onToday}>
              Today
            </Button>
            <p className="ml-1.5 min-w-[180px] text-sm font-semibold">{rangeLabel}</p>
          </div>
        ) : (
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, or notes…"
              className="w-full rounded-xl border border-input bg-background/40 py-2.5 pl-9 pr-3 text-sm transition-all duration-200 placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
            />
          </div>
        )}

        <div className="flex items-center rounded-xl border border-border/60 bg-surface/50 p-1">
          {(
            [
              ["all", "All"],
              ["agent1", "Agent 1"],
              ["agent2", "Agent 2"],
              ["rep", "Rep"],
            ] as [SourceFilter, string][]
          ).map(([s, label]) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={cn(seg, source === s ? on : off)}
            >
              {label}
            </button>
          ))}
        </div>

        {access.canTeam && reps.length > 0 && (
          <Select
            value={rep}
            onChange={(e) => setRep(e.target.value)}
            className="h-auto w-auto py-2 text-sm"
            aria-label="Rep"
          >
            <option value="all">All reps</option>
            {reps.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        )}

        {!isCalendar && (
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
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-xl border border-border/60 bg-surface/50 p-1">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={cn(seg, view === key ? on : off)}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {!isCalendar && (
            <button
              type="button"
              onClick={() => setDensity(density === "comfortable" ? "compact" : "comfortable")}
              className="hidden h-9 items-center gap-1.5 rounded-xl border border-border/60 bg-surface/50 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground lg:flex"
              title="Toggle density"
            >
              {density === "comfortable" ? "Comfortable" : "Compact"}
            </button>
          )}

          <Button variant="outline" size="sm" onClick={onSaveDefault} className="gap-1.5">
            {savedDefault ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Star className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{savedDefault ? "Saved" : "Save view"}</span>
          </Button>

          {access.canManage && (
            <Button size="sm" onClick={onCreate} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New</span>
            </Button>
          )}
        </div>
      </div>

      <p className="mt-2 px-1 text-[11px] text-muted-foreground">
        {matchCount} {matchCount === 1 ? "appointment" : "appointments"} match
        {isCalendar && " · drag to reschedule, drag the bottom edge to change the length"}
      </p>
    </Card>
  );
}

/** The alert 6.2 promises: a booking whose email never made it out. */
function FailedBanner({
  failed,
  busy,
  onRetry,
}: {
  failed: FailedNotice[];
  busy: boolean;
  onRetry: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger">
        <MailWarning className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-danger">
          {failed.length} appointment {failed.length === 1 ? "notification" : "notifications"} could
          not be sent
        </p>
        <p className="text-xs text-muted-foreground">
          {failed[0].leadName}
          {failed.length > 1 ? ` and ${failed.length - 1} more` : ""} — gave up after{" "}
          {failed[0].attempts} attempts. {failed[0].lastError}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => onRetry("all")}
        className="gap-1.5"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        Retry all
      </Button>
    </div>
  );
}

/** Bookings with no time on them — invisible to a grid, so surfaced beside it. */
function UnscheduledRail({
  items,
  onOpen,
}: {
  items: AppointmentRow[];
  onOpen: (a: AppointmentRow) => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-warning" />
        <p className="text-sm font-semibold">Needs a time ({items.length})</p>
        <p className="hidden text-xs text-muted-foreground sm:block">
          Agreed, but never pinned to a slot — so they can&apos;t appear on the grid.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a)}
            className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
          >
            {a.source === "ai" && <Sparkles className="h-3 w-3" />}
            <span className="max-w-[160px] truncate">{a.leadName}</span>
            {a.scheduledLabel && (
              <span className="max-w-[140px] truncate opacity-70">· {a.scheduledLabel}</span>
            )}
          </button>
        ))}
      </div>
    </Card>
  );
}

function BulkBar({
  count,
  busy,
  reduce,
  onApprove,
  onRoute,
  onClear,
}: {
  count: number;
  busy: boolean;
  reduce: boolean;
  onApprove: () => void;
  onRoute: (o: CallOutcome) => void;
  onClear: () => void;
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
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
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
          <Modal
            onClose={() => setRouting(false)}
            label={`Route ${count} back`}
            maxWidth="max-w-md"
            panelClassName="p-5"
            zIndex={101}
          >
            <div className="mb-4">
              <p className="text-base font-semibold">Route {count} back</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Re-file every selected lead under one disposition. This overrides the AI and
                updates reports.
              </p>
            </div>
            <OutcomeGrid
              onSelect={(o) => {
                setRouting(false);
                onRoute(o);
              }}
            />
          </Modal>
        )}
      </motion.div>
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
      <Button variant="outline" size="sm" onClick={onReset}>
        Reset filters
      </Button>
    </Card>
  );
}
