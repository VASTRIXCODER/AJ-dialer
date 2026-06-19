"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Bell, Menu, PhoneCall, Search } from "lucide-react";
import { Magnetic } from "@/components/motion";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export function Topbar({
  onMenuClick,
  voiceConfigured,
}: {
  onMenuClick: () => void;
  voiceConfigured: boolean;
}) {
  return (
    <div className="sticky top-0 z-30 px-3 pt-3 sm:px-5 sm:pt-4">
      <motion.header
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="glass flex h-[60px] items-center gap-3 rounded-2xl border border-border/60 px-3 py-2.5 sm:px-4"
      >
        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Universal search / command */}
        <div className="group relative hidden max-w-md flex-1 sm:block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <input
            placeholder="Search leads, reps, campaigns…"
            className="h-10 w-full rounded-xl border border-border/70 bg-background/40 pl-10 pr-16 text-sm transition-all placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline-flex">
            ⌘K
          </kbd>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
          <span
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:inline-flex",
              voiceConfigured
                ? "border-success/30 bg-success/10 text-success"
                : "border-warning/30 bg-warning/10 text-warning",
            )}
            title={
              voiceConfigured
                ? "Twilio Voice is connected"
                : "Calling is offline — add Twilio credentials to place live calls"
            }
          >
            <span className="relative flex h-1.5 w-1.5">
              {voiceConfigured && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
              )}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            {voiceConfigured ? "Twilio Live" : "Offline"}
          </span>

          <button
            type="button"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Notifications"
          >
            <Bell className="h-[18px] w-[18px]" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-background" />
          </button>

          <ThemeToggle />

          <Magnetic className="hidden sm:inline-flex">
            <Link
              href="/dialer"
              className={buttonVariants({
                size: "sm",
                className: "gap-2",
              })}
            >
              <PhoneCall className="h-4 w-4" />
              Start Dialing
            </Link>
          </Magnetic>
        </div>
      </motion.header>
    </div>
  );
}
