"use client";

import {
  AlertTriangle,
  Check,
  Loader2,
  PhoneOutgoing,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  DEFAULT_SEGMENTS,
  ORDER_LABELS,
  SEGMENTS,
  type ContactFilter,
  type DialSessionMeta,
  type SessionOrder,
} from "@/lib/dialer/segments";
import type { Lead, LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { groupLabel } from "./load-leads-dialog";
import { useDialerContext } from "./dialer-context";
import { resolveLeadTimezone } from "@/lib/dialer/lead-timezone";
import { isWithinOrgHours } from "@/lib/dialer/schedule";
import { SelectMenu } from "@/components/ui/select-menu";

interface Segment {
  key: string;
  label: string;
  tier: string;
  hint: string;
  count: number;
}
interface SegmentReport {
  total: number;
  neverContacted: number;
  contacted: number;
  segments: Segment[];
  dialableTotal: number;
}

/**
 * The session builder.
 *
 * Before this, "Load leads" grabbed whatever the dial queue happened to contain
 * — capped at 1,000 rows by PostgREST, restricted to three hardcoded statuses,
 * with no way to say how many to call or in what order. You could not run "the
 * 300 oldest callbacks" or "everything I've never dialed, best leads first",
 * and you could not see how many leads you even had (every count was an array
 * length, and the array was truncated).
 *
 * This makes the session an explicit, visible decision: which dispositions, in
 * what contact state, in what order, from which groups/campaign/scope, exactly
 * how many — and HOW the dialer treats the list (strict order vs pool refill,
 * the queue-fidelity contract that fixed the mis-dial bug).
 */
export function SessionBuilder({
  open,
  onClose,
  onLoad,
  onQuickLoad,
  campaigns = [],
  groups = [],
  leadGroupLabels = {},
  canOrgWide = false,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  /** Hand the built session to the dialer: the exact list + its claim contract. */
  onLoad: (leads: Lead[], meta: DialSessionMeta) => void;
  /** The one-click legacy load (default dial queue), kept reachable. */
  onQuickLoad?: () => void;
  /** The org's campaigns, for the campaign filter. */
  campaigns?: { id: string; name: string }[];
  /** The org's lead-intake groups, for the group filter. */
  groups?: { key: string; label: string }[];
  /** Per-org display-label overrides for the group chips. */
  leadGroupLabels?: Record<string, string>;
  /** Supervisors may build from the whole org's book. */
  canOrgWide?: boolean;
  /** The rep's remembered builder choices (profile preferences.dialerSession). */
  initial?: { statuses?: string[]; strictOrder?: boolean; refill?: boolean } | null;
}) {
  const vocab = useVocabulary();
  const [report, setReport] = useState<SegmentReport | null>(null);
  // Saved statuses are validated against the REAL segment keys — a stale
  // stored key would render no checked card while the server silently counted
  // its default fallback instead.
  // The workspace's own calling window and zone, for the pre-flight count.
  const { config } = useDialerContext();
  const hours = config.callingHours;
  const orgTz = config.orgTimezone || "America/Chicago";

  const knownKeys = new Set<string>(SEGMENTS.map((s) => s.key));
  const savedStatuses = (initial?.statuses ?? []).filter((s) => knownKeys.has(s));
  const [statuses, setStatuses] = useState<string[]>(
    savedStatuses.length ? savedStatuses : DEFAULT_SEGMENTS,
  );
  const [contact, setContact] = useState<ContactFilter>("any");
  // Upload order by default: a rep works a list the way it was handed to them,
  // and it's the only option whose sort key can't shift mid-session (ai_score is
  // rewritten by each call, which re-sorts the list underneath them).
  const [order, setOrder] = useState<SessionOrder>("oldest");
  const [limit, setLimit] = useState(100);
  const [campaignId, setCampaignId] = useState("");
  const [selGroups, setSelGroups] = useState<string[]>([]);
  const [orgWide, setOrgWide] = useState(false);
  // The queue-fidelity contract. Strict is the DEFAULT and the fix: the dialer
  // may only claim leads from this exact list, in this order.
  const [strictOrder, setStrictOrder] = useState(initial?.strictOrder ?? true);
  const [refill, setRefill] = useState(initial?.refill ?? false);
  const [available, setAvailable] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Exact, uncapped counts — COUNT queries, not array lengths. Re-fetched when
  // a supervisor flips the scope, so the cards count the population the
  // session will actually draw from.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetch(`/api/leads/segments${orgWide ? "?orgWide=1" : ""}`)
      .then((r) => r.json())
      .then((d: SegmentReport) => alive && setReport(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, orgWide]);

  // Live "this will call N leads" as the filters change.
  const spec = useCallback(
    () => ({
      statuses,
      contact,
      order,
      limit,
      campaignId: campaignId || null,
      groups: selGroups,
      orgWide: canOrgWide && orgWide,
    }),
    [statuses, contact, order, limit, campaignId, selGroups, canOrgWide, orgWide],
  );

  useEffect(() => {
    if (!open) return;
    // Nothing selected = nothing to call. The server would silently fall back
    // to the default segments here — the count must reflect the UI, not the
    // fallback, or "Load" ships statuses the cards show as unchecked.
    if (statuses.length === 0) {
      setAvailable(0);
      setPreviewing(false);
      return;
    }
    let alive = true;
    setPreviewing(true);
    const t = setTimeout(() => {
      void fetch("/api/leads/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...spec(), preview: true }),
      })
        .then((r) => r.json())
        .then((d: { available: number }) => {
          if (alive) setAvailable(d.available ?? 0);
        })
        .catch(() => undefined)
        .finally(() => alive && setPreviewing(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, spec, statuses.length]);

  // Workspace vocabulary on every rendered word: the segment defs carry the
  // NEUTRAL defaults, the org's own noun + no-need label win here (a
  // recruiting tenant must never read solar copy in its load flow).
  const segLabel = (key: string, label: string) =>
    key === "bills_fine" ? vocab.noNeedLabel : label.replace(/homeowner/gi, vocab.leadNoun);
  const segHint = (hint: string) => hint.replace(/homeowner/gi, vocab.leadNoun);

  const toggle = (key: string) =>
    setStatuses((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leads/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(spec()),
      });
      const json = (await res.json()) as { leads: Lead[]; count: number };
      // How many of this session cannot be dialed RIGHT NOW because it is the
      // wrong time where the contact is. The dial route already refuses these
      // one lane at a time, in the contact's own zone — but only after the rep
      // has pressed Start, so a session that is 40% Eastern at 8:45pm looked
      // like a full session and then cancelled its way through it.
      //
      // Same expression the dial route uses, so the two cannot disagree.
      const outOfWindow = hours
        ? json.leads.filter(
            (l) =>
              !isWithinOrgHours(
                new Date(),
                hours,
                resolveLeadTimezone(l.phone ?? "", l.timezone, orgTz),
              ),
          ).length
        : 0;
      const picked = report?.segments.filter((s) => statuses.includes(s.key)) ?? [];
      const parts = picked.map(
        (s) => `${Math.min(s.count, json.count)} ${segLabel(s.key, s.label).toLowerCase()}`,
      );
      const summary =
        `${json.count} ${vocab.leadNounPlural} · ${parts.slice(0, 3).join(", ")}` +
        (contact === "never" ? " · never contacted" : contact === "contacted" ? " · previously contacted" : "") +
        ` · ${ORDER_LABELS[order].toLowerCase()}` +
        (canOrgWide && orgWide ? " · whole org" : "") +
        (strictOrder ? " · strict list order" : " · pool order") +
        (refill ? " · auto-refill on" : "") +
        (outOfWindow
          ? ` · ${outOfWindow} outside their calling hours right now`
          : "");
      onLoad(json.leads, {
        statuses: statuses as LeadStatus[],
        strictOrder,
        refill,
        summary,
      });
    } catch {
      /* the dialer surfaces load failures */
    } finally {
      setLoading(false);
    }
  };

  const selectable = report?.segments.filter((s) => s.tier !== "blocked") ?? [];
  const blocked = report?.segments.filter((s) => s.tier === "blocked") ?? [];
  const willCall = Math.min(available ?? 0, limit);

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="session-builder-title"
      maxWidth="max-w-3xl"
      panelClassName="flex max-h-[92vh] flex-col overflow-hidden p-0"
    >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 id="session-builder-title" className="text-lg font-bold">
                  Build your calling session
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {report
                    ? `${report.total.toLocaleString()} ${vocab.leadNounPlural} in your book · ${report.dialableTotal.toLocaleString()} dialable`
                    : "Loading your book…"}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {/* Scope — supervisors only. Reps are own-scoped server-side. */}
              {canOrgWide && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Whose leads
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { on: false, label: "My uploads", hint: "Only leads you brought in." },
                        { on: true, label: "Whole org", hint: "Every rep's book — supervisor view." },
                      ] as const
                    ).map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        onClick={() => setOrgWide(o.on)}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          orgWide === o.on
                            ? "border-primary/60 bg-primary-soft"
                            : "border-border bg-surface/50 hover:bg-muted",
                        )}
                      >
                        <p className="text-sm font-semibold">{o.label}</p>
                        <p className="text-xs text-muted-foreground">{o.hint}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Campaign + groups — narrow the population before the segments. */}
              {(campaigns.length > 0 || groups.length > 0) && (
                <section className="grid gap-4 sm:grid-cols-2">
                  {campaigns.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Campaign
                      </h3>
                      <SelectMenu
                        label="Campaign"
                        className="w-full"
                        triggerClassName="h-10 w-full"
                        value={campaignId || "all"}
                        onChange={(v) => setCampaignId(v === "all" ? "" : v)}
                        options={[
                          { value: "all", label: "All campaigns" },
                          ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                        ]}
                      />
                    </div>
                  )}
                  {groups.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Groups
                      </h3>
                      <div className="flex flex-wrap gap-1.5">
                        {/* groupLabel applies the org's own display overrides
                            and names the no-group bucket the same word the
                            rest of the dialer uses. */}
                        {[...groups.map((g) => g.key), "unsorted"].map((key) => {
                          const on = selGroups.includes(key);
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                setSelGroups((s) =>
                                  on ? s.filter((k) => k !== key) : [...s, key],
                                )
                              }
                              className={cn(
                                "rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                                on
                                  ? "border-primary/60 bg-primary-soft text-primary"
                                  : "border-border text-muted-foreground hover:bg-muted",
                              )}
                            >
                              {groupLabel(key, leadGroupLabels, groups)}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        None selected = every group.
                      </p>
                    </div>
                  )}
                </section>
              )}

              {/* Contact state — the single most important dial decision, so it
                  leads. It's orthogonal to status: they AND together. */}
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Contact history
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { key: "any", label: "Any", count: report?.total },
                      { key: "never", label: "Never called", count: report?.neverContacted },
                      { key: "contacted", label: "Called before", count: report?.contacted },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setContact(o.key)}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-colors",
                        contact === o.key
                          ? "border-primary/60 bg-primary-soft"
                          : "border-border bg-surface/50 hover:bg-muted",
                      )}
                    >
                      <p className="text-sm font-semibold">{o.label}</p>
                      <p className="text-xs tabular text-muted-foreground">
                        {o.count?.toLocaleString() ?? "—"}
                      </p>
                    </button>
                  ))}
                </div>
              </section>

              {/* Dispositions */}
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Which dispositions to call
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {selectable.map((s) => {
                    const on = statuses.includes(s.key);
                    const optIn = s.tier === "optin";
                    return (
                      <button
                        key={s.key}
                        type="button"
                        title={segHint(s.hint)}
                        onClick={() => toggle(s.key)}
                        className={cn(
                          "relative rounded-xl border p-3 text-left transition-colors",
                          on
                            ? optIn
                              ? "border-warning/60 bg-warning/10"
                              : "border-primary/60 bg-primary-soft"
                            : "border-border bg-surface/50 hover:bg-muted",
                        )}
                      >
                        {on && (
                          <Check
                            className={cn(
                              "absolute right-2 top-2 h-3.5 w-3.5",
                              optIn ? "text-warning" : "text-primary",
                            )}
                          />
                        )}
                        <p className="pr-4 text-sm font-semibold">{segLabel(s.key, s.label)}</p>
                        <p className="text-xs tabular text-muted-foreground">
                          {s.count.toLocaleString()}
                        </p>
                        {optIn && on && (
                          <p className="mt-1 text-[11px] leading-tight text-warning">
                            {segHint(s.hint)}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
                {blocked.map((s) => (
                  <p
                    key={s.key}
                    className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {s.count.toLocaleString()} {segLabel(s.key, s.label).toLowerCase()}{" "}
                    {vocab.leadNounPlural} are excluded and can never be dialed.
                  </p>
                ))}
              </section>

              {/* Order + how many */}
              <section className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Call order
                  </h3>
                  <div className="space-y-1.5">
                    {(Object.keys(ORDER_LABELS) as SessionOrder[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setOrder(k)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                          order === k
                            ? "border-primary/60 bg-primary-soft font-semibold"
                            : "border-border bg-surface/50 hover:bg-muted",
                        )}
                      >
                        {ORDER_LABELS[k]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    How many to call
                  </h3>
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
                    className="tabular"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[50, 100, 250, 500, 1000].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setLimit(n)}
                        className={cn(
                          "rounded-lg px-2 py-1 text-xs font-semibold transition-colors",
                          limit === n
                            ? "bg-primary text-white"
                            : "bg-muted text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {n}
                      </button>
                    ))}
                    {available != null && available > 0 && (
                      <button
                        type="button"
                        onClick={() => setLimit(available)}
                        className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                      >
                        All {available.toLocaleString()}
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* Dialing behavior — the queue-fidelity contract. */}
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Dialing behavior
                </h3>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/50 px-4 py-3">
                    <span>
                      <span className="block text-sm font-medium">
                        Dial exactly this list, in this order
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        The dialer will only ever call leads from the session you just
                        built, top to bottom. Turn off to let it pick from your whole
                        eligible pool instead (never-dialed first).
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={strictOrder}
                      onChange={(e) => setStrictOrder(e.target.checked)}
                      className="h-5 w-5 accent-[hsl(var(--primary))]"
                    />
                  </label>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/50 px-4 py-3">
                    <span>
                      <span className="block text-sm font-medium">
                        Auto-refill when the list runs out
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        When every lead in this session is done, keep dialing from your
                        eligible pool — you’ll be told each time a refill happens.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={refill}
                      onChange={(e) => setRefill(e.target.checked)}
                      className="h-5 w-5 accent-[hsl(var(--primary))]"
                    />
                  </label>
                </div>
              </section>
            </div>

            {/* Summary + load */}
            <div className="flex flex-col gap-3 border-t border-border bg-surface/50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                {statuses.length === 0 ? (
                  <span className="text-warning">
                    Pick at least one disposition to call.
                  </span>
                ) : previewing ? (
                  <span className="text-muted-foreground">Counting…</span>
                ) : available === 0 ? (
                  <span className="text-warning">
                    No {vocab.leadNounPlural} match these filters.
                  </span>
                ) : (
                  <span>
                    This session will call{" "}
                    <b className="tabular">{willCall.toLocaleString()}</b>{" "}
                    {willCall === 1 ? vocab.leadNoun : vocab.leadNounPlural}
                    {available != null && available > willCall && (
                      <span className="text-muted-foreground">
                        {" "}
                        of {available.toLocaleString()} matching
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {onQuickLoad && (
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={onQuickLoad}
                    title="Skip the builder: load your default dial queue (new / no-answer / callback, upload order, strict list)."
                  >
                    Quick load
                  </Button>
                )}
                <Button
                  onClick={load}
                  disabled={loading || !willCall || statuses.length === 0}
                  className="gap-2"
                  size="lg"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PhoneOutgoing className="h-4 w-4" />
                  )}
                  Load {willCall.toLocaleString()} {vocab.leadNounPlural}
                </Button>
              </div>
            </div>
    </Modal>
  );
}
