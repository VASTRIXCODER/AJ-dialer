"use client";

import { AlarmClock, Compass, Flame, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import {
  nextActionLabel,
  STAGE_LABELS,
  whyNowLine,
  type OpportunityContext,
} from "@/lib/opportunities/why-now";
import { cn, relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// "Why this person now" (P2.3): the pre-call brief. One compact, silent block —
// the dialer is Instrument surface, so no motion, no gradients, nothing louder
// than the lead's own name. Renders NOTHING until real data arrives and
// nothing at all when there is none (no fake zeros, no reserved space).
// ─────────────────────────────────────────────────────────────────────────────

/** How long a fetched brief stays trustworthy. A disposition changes the
 *  opportunity, so paging back to a lead after working others must re-read —
 *  a forever-cache would show yesterday's "why" next to today's person. */
const CACHE_TTL_MS = 60_000;

export function WhyNowCard({ leadId }: { leadId: string }) {
  const vocab = useVocabulary();
  const [ctx, setCtx] = useState<OpportunityContext | null>(null);
  // Short-lived cache: quick prev/next paging must not refetch or flash, but
  // stale entries expire (see CACHE_TTL_MS).
  const cacheRef = useRef<Map<string, { value: OpportunityContext | null; at: number }>>(
    new Map(),
  );

  useEffect(() => {
    const cached = cacheRef.current.get(leadId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setCtx(cached.value);
      return;
    }
    setCtx(null);
    const ac = new AbortController();
    fetch(`/api/opportunities/context?leadId=${encodeURIComponent(leadId)}`, {
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : { context: null }))
      .then((j: { context?: OpportunityContext | null }) => {
        const value = j.context ?? null;
        cacheRef.current.set(leadId, { value, at: Date.now() });
        setCtx(value);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [leadId]);

  if (!ctx) return null;

  const line = whyNowLine(ctx, vocab.leadNoun);

  return (
    <section
      aria-label="Why this person now"
      className="mt-3 rounded-xl border border-border/70 bg-muted/30 p-2.5"
    >
      <div className="flex items-center gap-1.5">
        <Compass className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Why now
        </p>
        <span
          className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
        >
          {STAGE_LABELS[ctx.stage] ?? ctx.stage}
        </span>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-foreground">{line}</p>

      {ctx.nextActionKind && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <AlarmClock className="h-3 w-3 shrink-0" />
          <span>
            Next: {nextActionLabel(ctx.nextActionKind)}
            {ctx.nextActionDueAt ? ` · ${relativeTime(ctx.nextActionDueAt)}` : ""}
          </span>
        </p>
      )}

      {ctx.signals.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {ctx.signals.slice(0, 2).map((sig) => (
            <li
              key={sig.id}
              className={cn(
                "flex items-start gap-1.5 text-[11px]",
                sig.severity >= 4 ? "text-danger" : "text-warning",
              )}
            >
              <Flame className="mt-px h-3 w-3 shrink-0" />
              <span>
                {sig.reason || sig.type.replace(/_/g, " ")} ·{" "}
                {relativeTime(sig.detectedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {ctx.playbooks.length > 0 && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Workflow className="h-3 w-3 shrink-0" />
          <span>
            {ctx.playbooks.map((p) => `${p.name} (step ${p.step + 1})`).join(" · ")}
          </span>
        </p>
      )}

      <p className="mt-1.5 text-[11px] tabular text-muted-foreground">
        {ctx.attemptCount} attempt{ctx.attemptCount === 1 ? "" : "s"} ·{" "}
        {ctx.contactCount} conversation{ctx.contactCount === 1 ? "" : "s"}
        {ctx.lastTouchedAt ? ` · last ${relativeTime(ctx.lastTouchedAt)}` : ""}
      </p>
    </section>
  );
}
