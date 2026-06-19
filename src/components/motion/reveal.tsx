"use client";

import { motion, useReducedMotion } from "framer-motion";
import * as React from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Reveal — fades + lifts its children into view as they enter the viewport.
 * Falls back to plain rendering when the user prefers reduced motion.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Stagger — orchestrates a sequence of <RevealItem> children so they cascade
 * into view one after another. Use for grids, lists and KPI rows.
 */
export function Stagger({
  children,
  className,
  stagger = 0.07,
  delayChildren = 0.04,
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delayChildren?: number;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: "0px 0px -8% 0px" }}
      variants={{
        show: { transition: { staggerChildren: stagger, delayChildren } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
  y = 18,
}: {
  children: React.ReactNode;
  className?: string;
  y?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}
