import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Progress and Ring render their real value on first paint.
//
// Both used to start at zero and fill on scroll-into-view, so a bar at 87%
// spent a second claiming to be at 0% — the same defect as a KPI counting up
// from a literal zero, and just as misleading, because zero is a real answer.
//
// Progress also carried a permanent white shimmer sweeping across the fill.
// It was hardcoded rgba(255,255,255,0.4), which is invisible on a light
// background, and a shimmer on a settled value reads as "still loading" when
// nothing is loading.
//
// A width/stroke transition replaces the entry animation, so a value that
// CHANGES still moves — which is the case where the movement means something.
// The global prefers-reduced-motion block in globals.css collapses transition
// durations, so no JS motion check is needed here.
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (n: number) => Math.min(100, Math.max(0, n));

export function Progress({
  value,
  className,
  barClassName,
  /** What this bar measures, for assistive tech. */
  label,
}: {
  value: number;
  className?: string;
  barClassName?: string;
  label?: string;
}) {
  const pct = clamp(value);
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn(
          "h-full rounded-full bg-brand transition-[width] duration-500 ease-out",
          barClassName,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Ring({
  value,
  size = 64,
  stroke = 6,
  className,
  children,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
  label?: string;
}) {
  const pct = clamp(value);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="fill-none stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="fill-none stroke-primary transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular">
        {children}
      </span>
    </div>
  );
}
