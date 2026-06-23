"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Route transition for the app shell's content area. A Next `template` re-mounts
 * on every navigation, so this gives a smooth cross-fade between pages while the
 * sidebar/topbar stay put. Opacity-only on purpose — it layers cleanly over the
 * per-page `.page-reveal` stagger instead of fighting its upward motion. Skipped
 * entirely for users who prefer reduced motion.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
