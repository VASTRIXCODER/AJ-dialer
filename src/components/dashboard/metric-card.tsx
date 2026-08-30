import { ArrowDownRight, ArrowUpRight, Info, type LucideIcon } from "lucide-react";
import { CountUp } from "@/components/motion";
import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { METRICS, type MetricId } from "@/lib/metrics/definitions";
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
  /** The window and the scope this number covers. "today", "90d · whole org". */
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
  const parsed = value === null ? null : parseMetric(value);
  const caption = value === null ? unavailable : sub;

  return (
    // Fixed minimum height and a reserved caption line, so a row of tiles is a
    // row rather than a ragged edge — one tile having a scope line and its
    // neighbour not is not a reason for them to be different heights.
    <Card className={cn("flex min-h-[132px] flex-col overflow-hidden p-5", className)}>
      <div className="relative flex flex-1 items-start justify-between">
        <div className="flex h-full flex-col gap-2">
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
              (value ?? <span className="text-ink-3">—</span>)
            )}
          </p>
          <div className="mt-auto flex min-h-[18px] items-center gap-2">
            {delta && value !== null && (
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
              <span
                className={cn(
                  "text-label-12",
                  value === null ? "text-signal-ring" : "text-muted-foreground",
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
