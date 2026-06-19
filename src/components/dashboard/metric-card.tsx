import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { CountUp } from "@/components/motion";
import { SpotlightCard } from "@/components/motion/spotlight-card";
import { cn } from "@/lib/utils";

type Accent = "primary" | "accent" | "success" | "warning" | "danger";

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
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: { value: string; positive: boolean };
  icon: LucideIcon;
  accent?: Accent;
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

  const parsed = parseMetric(value);

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
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {label}
          </p>
          <p className="text-4xl font-bold tracking-tight tabular">
            {parsed ? (
              <CountUp
                value={parsed.num}
                decimals={parsed.decimals}
                prefix={parsed.prefix}
                suffix={parsed.suffix}
              />
            ) : (
              value
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
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {delta.value}
              </span>
            )}
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
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
