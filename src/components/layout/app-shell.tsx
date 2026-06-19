"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/** Fixed, cinematic ambient backdrop rendered behind the entire app. */
function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-aurora"
    >
      {/* Floating ambient light sources — barely perceptible, always present */}
      <div className="glow-orb absolute -left-32 -top-40 h-[34rem] w-[34rem] animate-aurora opacity-70" />
      <div
        className="glow-orb absolute -right-40 top-1/4 h-[30rem] w-[30rem] animate-aurora opacity-50"
        style={{ animationDelay: "-8s" }}
      />
      <div
        className="glow-orb absolute bottom-[-12rem] left-1/3 h-[36rem] w-[36rem] animate-aurora opacity-40"
        style={{ animationDelay: "-16s" }}
      />
      {/* Structural grid + grain for depth without flatness */}
      <div className="absolute inset-0 bg-grid opacity-[0.5]" />
      <div className="absolute inset-0 bg-noise opacity-[0.015] mix-blend-overlay dark:opacity-[0.03]" />
    </div>
  );
}

export function AppShell({
  children,
  voiceConfigured,
}: {
  children: React.ReactNode;
  voiceConfigured: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="relative flex min-h-screen">
      <AmbientBackground />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-background/60 backdrop-blur-md lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
              className="fixed inset-y-0 left-0 z-50 w-[284px] lg:hidden"
            >
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="absolute right-3 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[268px]">
        <Topbar
          onMenuClick={() => setMobileOpen(true)}
          voiceConfigured={voiceConfigured}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
