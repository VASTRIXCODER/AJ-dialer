"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * App-wide reduced-motion guard for framer-motion. The CSS animations are
 * already stilled by the prefers-reduced-motion block in globals.css, but
 * framer drives transforms from JS via inline styles, which that block can't
 * reach — so every motion.* component that doesn't check useReducedMotion()
 * itself kept animating for users who asked for less motion. With
 * reducedMotion="user", framer disables transform/layout animations globally
 * (opacity fades remain, per its a11y model); the per-component
 * useReducedMotion() checks stay for the cases that swap out entirely.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
