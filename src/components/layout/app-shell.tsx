"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useState } from "react";
import { CommandPalette } from "@/components/ai/command-palette";
import { AmbientBackground } from "./ambient-background";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

type Account = { name: string; email: string; initials: string };

export function AppShell({
  children,
  voiceConfigured,
  aiConfigured,
  account,
  superadmin = false,
}: {
  children: React.ReactNode;
  voiceConfigured: boolean;
  aiConfigured: boolean;
  account: Account | null;
  superadmin?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="relative flex min-h-screen">
      <AmbientBackground />
      <CommandPalette />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] lg:block">
        <Sidebar account={account} superadmin={superadmin} />
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
              <Sidebar
                account={account}
                superadmin={superadmin}
                onNavigate={() => setMobileOpen(false)}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[268px]">
        <Topbar
          onMenuClick={() => setMobileOpen(true)}
          voiceConfigured={voiceConfigured}
          aiConfigured={aiConfigured}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
