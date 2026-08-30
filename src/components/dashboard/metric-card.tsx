import { ArrowDownRight, ArrowUpRight, Info, type LucideIcon } from "lucide-react";
import { CountUp } from "@/components/motion";
import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import {
  METRICS,
  metricCaption,
  type MetricId,
  type MetricScope,
  type MetricWindow,
} from "@/lib/metrics/definitions";
import { cn } from "@/lib/utils";

type Accent = "primary" | "accent" | "success" | "warning" | "danger";

/**
 * The glossary tooltip for a metric tile — the SAME description every surface
 * shares (src/lib/metrics/definitions.ts), plus what the number divides by and
 * what is deliberately not in it. Keyboard-reachable (the trigger is a
 * focusable button) so the definition isn't hover-only.
 */
function DefinitionHint({ id }: { id: MetricId }) {
  const def = METRICS[id];
  return (
    <Tooltip
      content={
        <span className="block max-w-[16rem] space-y-1">
          <span className="block">{def.description}</span>
          {def.denominator && (
            <span className="block text-muted-foreground">Denominator: {def.denominator}</span>
          )}
          {def.excludes.length > 0 && (
            <span className="block text-muted-foreground">
              Excludes: {def.excludes.join("; ")}.
            </span>
          )}
        </span>
      }
    >
      {/* A focusable span, not a <button>: KPI cards can be wrapped in a
          DrillLink <a>, and interactive content inside an anchor is invalid
          HTML (and would navigate on click). Focus still opens the tooltip. */}
      <span
        tabIndex={0}
        aria-label={`What "${def.label}" means`}
        className="inline-flex cursor-help text-ink-3 transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground"
      >
        <Info className="h-3 w-3" />
      </span>
    </Tooltip>
  );
}

/** Split a formatted metric ("$1,284", "73%", "4.8") into animatable parts. */
function parseMetric(value: string) {
  const prefix = value.match(/^[^\d-]*/)?.[0] ?? "";
  const suffix = value.match(/[^\d.]*$/)?.[0] ?? "";
  const core = value.slice(prefix.length, value.length - suffix.length);
  if (!core) return null;
  const num = Number(core.replace(/,/g, ""));
  if (Number.isNaN(num)) return null;
  const dot = core.indexOf(".");
  const decimals = dot === -1 ? 0 : core.length - dot - 1;
  return { prefix, suffix, num, decimals };
}

export function MetricCard({
  label,
  value,
  window,
  scope,
  windowDetail,
  sub,
  unavailable,
  delta,
  icon: Icon,
  accent = "primary",
  definitionKey,
  className,
}: {
  label: string;
  /**
   * The formatted number, or `null` when it could not be computed.
   *
   * THE ZERO RULE. A tile that cannot answer renders an em dash, never `0`.
   * Zero is a real answer — "nobody called today" — and a reader has no way to
   * tell it apart from "the query failed". This matters more here than
   * anywhere else in the product, because supabase-js does not throw on a
   * failed read: it resolves `{ data: null, count: null, error }`, so the
   * house idiom `count ?? 0` silently converts "we could not ask" into "the
   * answer is none". Callers whose number comes from a count should type it
   * `number | null` and pass `null` through rather than defaulting it.
   */
  value: string | null;
  /**
   * The window this number covers, and whose rows it counts.
   *
   * Enums rather than prose, deliberately. Before this, the same window was
   * written three different ways on three screens ("today", "dials placed
   * today", "Today so far · you") and "Appointments" meant five different
   * things with nothing on any tile to tell them apart. A screen chooses WHICH
   * window it is showing; the words come from src/lib/metrics/definitions.ts,
   * so two tiles covering the same window cannot describe it differently.
   */
  window?: MetricWindow;
  scope?: MetricScope;
  /** The resolved dates, for the one window that can't be named in advance —
   *  a range bar's selection. Reads "selected period (1–30 Aug) · whole org". */
  windowDetail?: string;
  /** A caption that isn't a window and a scope. Prefer the two above; this is
   *  for the handful of tiles whose caption is genuinely something else. */
  sub?: string;
  /** Why the number is missing. Required when `value` is null, shown in place
   *  of `sub` — an em dash with no explanation is its own small mystery. */
  unavailable?: string;
  /** srLabel is the screen-reader sentence behind the ▲/▼ ("up 12 vs …"). */
  delta?: { value: string; positive: boolean; srLabel?: string };
  icon: LucideIcon;
  accent?: Accent;
  /** Glossary id — renders an ⓘ tooltip with the metric's one true definition. */
  definitionKey?: MetricId;
  className?: string;
}) {
  const accents: Record<Accent, string> = {
    primary: "bg-primary-soft text-primary",
    accent: "bg-accent-soft text-accent",
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-danger/12 text-danger",
  };
  // No hover glow. A blurred accent light woke behind every KPI tile on
  // pointer-over — depth on the surface a rep reads most, for no information.
  // A stringified nothing is nothing. Two shipped pages built their value with
  // `String(x)` where x was `number | null` — the DB layer had plumbed the null
  // all the way up, exactly as the zero rule intends, and the last line threw
  // it away. `String(null)` is the four-character string "null", which
  // parseMetric cannot read a number out of, so the card fell through to
  // rendering `value` verbatim: the word "null", in 40px tabular numerals,
  // where a total belongs.
  //
  // Guarding here rather than only at the call sites, because this is the one
  // place that can be sure — and because the next person to write `String(...)`
  // in a tile will not have read the two commits about it.
  const resolved =
    value === "null" || value === "undefined" || value === "NaN" ? null : value;
  const parsed = resolved === null ? null : parseMetric(resolved);
  // The window and the scope ARE the caption when both are given; `sub` is the
  // exception, not the rule.
  const scopeLine = window && scope ? metricCaption(window, scope, windowDetail) : sub;
  const caption = resolved === null ? unavailable : scopeLine;

  return (
    // Fixed minimum height and a reserved caption line, so a row of tiles is a
    // row rather than a ragged edge — one tile having a scope line and its
    // neighbour not is not a reason for them to be different heights.
    <Card className={cn("flex min-h-[132px] flex-col overflow-hidden p-5", className)}>
      <div className="relative flex flex-1 items-start justify-between">
        {/* min-w-0 so the caption's truncate actually engages: a flex child
            defaults to min-width:auto and refuses to shrink below its text. */}
        <div className="flex h-full min-w-0 flex-1 flex-col gap-2">
          <p className="flex items-center gap-1 text-caps-11 uppercase text-muted-foreground">
            {label}
            {definitionKey && <DefinitionHint id={definitionKey} />}
          </p>
          <p className="text-metric-40 tabular">
            {parsed ? (
              <CountUp
                value={parsed.num}
                decimals={parsed.decimals}
                prefix={parsed.prefix}
                suffix={parsed.suffix}
              />
            ) : (
              // The zero rule: an em dash, never a fabricated zero.
              (resolved ?? <span className="text-ink-3">—</span>)
            )}
          </p>
          <div className="mt-auto flex min-h-[18px] items-center gap-2">
            {delta && resolved !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold",
                  delta.positive
                    ? "bg-success/12 text-success"
                    : "bg-danger/12 text-danger",
                )}
              >
                {delta.positive ? (
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                ) : (
                  <ArrowDownRight className="h-3 w-3" aria-hidden />
                )}
                <span aria-hidden={Boolean(delta.srLabel)}>{delta.value}</span>
                {/* The arrow is decoration; this is what a screen reader hears. */}
                {delta.srLabel && <span className="sr-only">{delta.srLabel}</span>}
              </span>
            )}
            {caption && (
              // ONE line, truncated, with the full text on hover. A caption
              // that wraps makes its tile taller than the tiles beside it, and
              // a KPI row with one card standing proud reads as a rendering
              // fault rather than a design.
              <span
                title={caption}
                className={cn(
                  "min-w-0 truncate text-label-12",
                  resolved === null ? "text-signal-ring" : "text-muted-foreground",
                )}
              >
                {caption}
              </span>
            )}
          </div>
        </div>
        {/* No hover scale. The icon identifies the tile; it is not a control. */}
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
            accents[accent],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}
