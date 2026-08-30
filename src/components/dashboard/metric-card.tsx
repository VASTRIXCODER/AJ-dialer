import { ArrowDownRight, ArrowUpRight, Info, type LucideIcon } from "lucide-react";
import { CountUp } from "@/components/motion";
import { SpotlightCard } from "@/components/motion/spotlight-card";
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
        className="inline-flex cursor-help text-muted-foreground/60 transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground"
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
  delta,
  icon: Icon,
  accent = "primary",
  definitionKey,
  unavailable,
  className,
}: {
  label: string;
  /**
   * The formatted number, or NULL when it could not be computed.
   *
   * Null is not zero. supabase-js resolves rather than throws, so `count ?? 0`
   * turns "we could not ask" into "there are none" — and a confident 0 on a
   * leadership dashboard is the kind of wrong that gets acted on. A null value
   * renders an em dash and REQUIRES `unavailable` to say why.
   */
  value: string | null;
  sub?: string;
  /** srLabel is the screen-reader sentence behind the ▲/▼ ("up 12 vs …"). */
  delta?: { value: string; positive: boolean; srLabel?: string };
  icon: LucideIcon;
  accent?: Accent;
  /** Glossary id — renders an ⓘ tooltip with the metric's one true definition. */
  definitionKey?: MetricId;
  /**
   * Why this number is missing. Shown in place of `sub` when `value` is null.
   *
   * An em dash on its own is a small mystery; the reader cannot tell a broken
   * query from a feature nobody has switched on. Every card that CAN be
   * unavailable must say which.
   */
  unavailable?: string;
  className?: string;
}) {
  const accents: Record<Accent, string> = {
    primary: "bg-primary-soft text-primary",
    accent: "bg-accent-soft text-accent",
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-danger/12 text-danger",
  };
  const glows: Record<Accent, string> = {
    primary: "bg-primary/25",
    accent: "bg-accent/25",
    success: "bg-success/25",
    warning: "bg-warning/25",
    danger: "bg-danger/25",
  };

  const missing = value === null;
  const parsed = missing ? null : parseMetric(value);

  return (
    <SpotlightCard className={cn("overflow-hidden p-5", className)}>
      {/* Ambient accent light that wakes on hover */}
      <div
        className={cn(
          "pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100",
          glows[accent],
        )}
      />

      <div className="relative flex items-start justify-between">
        <div className="space-y-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {label}
            {definitionKey && <DefinitionHint id={definitionKey} />}
          </p>
          <p
            className={cn(
              "text-4xl font-bold tracking-tight tabular",
              missing && "text-muted-foreground/50",
            )}
          >
            {parsed ? (
              <CountUp
                value={parsed.num}
                decimals={parsed.decimals}
                prefix={parsed.prefix}
                suffix={parsed.suffix}
              />
            ) : (
              <span aria-label={missing ? `${label}: not available` : undefined}>
                {missing ? "—" : value}
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {delta && (
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
            {/* The reason wins over the sub-label: when a number is missing,
                why it is missing is the only useful thing left to say. */}
            {missing && unavailable ? (
              <span className="text-xs text-muted-foreground">{unavailable}</span>
            ) : (
              sub && <span className="text-xs text-muted-foreground">{sub}</span>
            )}
          </div>
        </div>
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset ring-white/5 transition-transform duration-300 group-hover:scale-110",
            accents[accent],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </SpotlightCard>
  );
}
