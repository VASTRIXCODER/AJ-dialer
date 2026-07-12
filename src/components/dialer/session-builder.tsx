"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Loader2,
  PhoneOutgoing,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_SEGMENTS,
  ORDER_LABELS,
  type ContactFilter,
  type SessionOrder,
} from "@/lib/dialer/segments";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

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

export interface LoadedSession {
  leads: Lead[];
  summary: string;
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
 * what contact state, in what order, and exactly how many.
 */
export function SessionBuilder({
  open,
  onClose,
  onLoad,
}: {
  open: boolean;
  onClose: () => void;
  onLoad: (session: LoadedSession) => void;
}) {
  const [report, setReport] = useState<SegmentReport | null>(null);
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_SEGMENTS);
  const [contact, setContact] = useState<ContactFilter>("any");
  const [order, setOrder] = useState<SessionOrder>("ai_score");
  const [limit, setLimit] = useState(100);
  const [available, setAvailable] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Exact, uncapped counts — COUNT queries, not array lengths.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetch("/api/leads/segments")
      .then((r) => r.json())
      .then((d: SegmentReport) => alive && setReport(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  // Live "this will call N leads" as the filters change.
  const spec = useCallback(
    () => ({ statuses, contact, order, limit }),
    [statuses, contact, order, limit],
  );

  useEffect(() => {
    if (!open) return;
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
  }, [open, spec]);

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
      const picked = report?.segments.filter((s) => statuses.includes(s.key)) ?? [];
      const parts = picked.map((s) => `${Math.min(s.count, json.count)} ${s.label.toLowerCase()}`);
      onLoad({
        leads: json.leads,
        summary:
          `${json.count} leads · ${parts.slice(0, 3).join(", ")}` +
          (contact === "never" ? " · never contacted" : contact === "contacted" ? " · previously contacted" : "") +
          ` · ${ORDER_LABELS[order].toLowerCase()}`,
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
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-lift sm:rounded-2xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-bold">Build your calling session</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {report
                    ? `${report.total.toLocaleString()} leads in your book · ${report.dialableTotal.toLocaleString()} dialable`
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
                        title={s.hint}
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
                        <p className="pr-4 text-sm font-semibold">{s.label}</p>
                        <p className="text-xs tabular text-muted-foreground">
                          {s.count.toLocaleString()}
                        </p>
                        {optIn && on && (
                          <p className="mt-1 text-[10px] leading-tight text-warning">{s.hint}</p>
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
                    {s.count.toLocaleString()} {s.label.toLowerCase()} leads are excluded and can
                    never be dialed.
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
            </div>

            {/* Summary + load */}
            <div className="flex flex-col gap-3 border-t border-border bg-surface/50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                {previewing ? (
                  <span className="text-muted-foreground">Counting…</span>
                ) : available === 0 ? (
                  <span className="text-warning">No leads match these filters.</span>
                ) : (
                  <span>
                    This session will call{" "}
                    <b className="tabular">{willCall.toLocaleString()}</b> lead
                    {willCall === 1 ? "" : "s"}
                    {available != null && available > willCall && (
                      <span className="text-muted-foreground">
                        {" "}
                        of {available.toLocaleString()} matching
                      </span>
                    )}
                  </span>
                )}
              </div>
              <Button
                onClick={load}
                disabled={loading || !willCall}
                className="gap-2"
                size="lg"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PhoneOutgoing className="h-4 w-4" />
                )}
                Load {willCall.toLocaleString()} leads
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
