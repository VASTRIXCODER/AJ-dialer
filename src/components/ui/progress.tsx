"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

export function Progress({
  value,
  className,
  barClassName,
}: {
  value: number;
  className?: string;
  barClassName?: string;
}) {
  const reduce = useReducedMotion();
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      <motion.div
        className={cn("relative h-full rounded-full bg-brand", barClassName)}
        initial={reduce ? false : { width: 0 }}
        whileInView={reduce ? undefined : { width: `${pct}%` }}
        viewport={{ once: true, margin: "0px 0px -8% 0px" }}
        transition={{ duration: 1, ease: EASE }}
        style={reduce ? { width: `${pct}%` } : undefined}
      >
        <span className="animate-shimmer absolute inset-0 bg-[length:200%_100%] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent)]" />
      </motion.div>
    </div>
  );
}

export function Ring({
  value,
  size = 64,
  stroke = 6,
  className,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, value)) / 100) * c;
  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="fill-none stroke-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={reduce ? false : { strokeDashoffset: c }}
          whileInView={reduce ? undefined : { strokeDashoffset: offset }}
          viewport={{ once: true, margin: "0px 0px -8% 0px" }}
          transition={{ duration: 1.1, ease: EASE }}
          style={reduce ? { strokeDashoffset: offset } : undefined}
          className="fill-none stroke-primary"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular">
        {children}
      </span>
    </div>
  );
}
