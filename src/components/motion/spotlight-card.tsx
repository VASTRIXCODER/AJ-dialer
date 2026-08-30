"use client";

import {
  type HTMLMotionProps,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SpotlightCard — a glass surface that behaves like a physical object: it tilts
 * subtly toward the pointer, a soft spotlight tracks the cursor, and it lifts on
 * hover. Visually identical at rest to <Card>, so it's a drop-in upgrade.
 */
export function SpotlightCard({
  children,
  className,
  tilt = true,
  spotlight = true,
  style,
  ...props
}: HTMLMotionProps<"div"> & {
  tilt?: boolean;
  spotlight?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);

  // Normalized pointer position (-0.5 … 0.5) drives the tilt.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const spring = { stiffness: 150, damping: 18, mass: 0.5 };
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [6, -6]), spring);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-6, 6]), spring);

  // Raw pixel position drives the spotlight gradient.
  const sx = useMotionValue(50);
  const sy = useMotionValue(0);
  const spotlightBg = useMotionTemplate`radial-gradient(20rem 20rem at ${sx}px ${sy}px, hsl(var(--glow) / 0.18), transparent 60%)`;

  const interactive = !reduce;

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
    sx.set(e.clientX - r.left);
    sy.set(e.clientY - r.top);
  }

  function handleLeave() {
    px.set(0);
    py.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      style={{
        ...style,
        ...(interactive && tilt
          ? { rotateX, rotateY, transformPerspective: 1000 }
          : {}),
      }}
      className={cn(
        "group relative rounded-2xl border border-border/60 surface-glass text-card-foreground",
        interactive && "hover-lift",
        className,
      )}
      {...props}
    >
      {interactive && spotlight && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: spotlightBg }}
        />
      )}
      <div className="relative z-[1] h-full [transform-style:preserve-3d]">
        {children as React.ReactNode}
      </div>
    </motion.div>
  );
}
