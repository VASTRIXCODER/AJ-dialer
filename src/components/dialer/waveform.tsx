"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Waveform — a live-audio visualization for the active call. Bars rise from a
 * bell-shaped baseline and breathe continuously; they flatten on hold and dim
 * when muted. Purely decorative, reduced-motion aware.
 */
export function Waveform({
  active = true,
  muted = false,
  bars = 32,
  className,
}: {
  active?: boolean;
  muted?: boolean;
  bars?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const center = (bars - 1) / 2;

  return (
    <div
      aria-hidden
      className={cn("flex h-10 items-center justify-center gap-[3px]", className)}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const dist = Math.abs(i - center) / center; // 0 center → 1 edges
        const peak = 1 - dist * 0.72;
        const color = muted
          ? "bg-muted-foreground/40"
          : "bg-gradient-to-t from-success/40 to-success";

        if (reduce || !active) {
          return (
            <span
              key={i}
              className={cn("w-[3px] rounded-full", color)}
              style={{ height: 5 + peak * 6 }}
            />
          );
        }

        const min = 4 + peak * 4;
        const max = 8 + peak * 26;
        return (
          <motion.span
            key={i}
            className={cn("w-[3px] rounded-full", color)}
            initial={{ height: min }}
            animate={{ height: [min, max, min] }}
            transition={{
              duration: 0.7 + (i % 5) * 0.13,
              repeat: Infinity,
              repeatType: "mirror",
              ease: "easeInOut",
              delay: i * 0.035,
            }}
          />
        );
      })}
    </div>
  );
}
