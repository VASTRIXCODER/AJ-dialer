"use client";

import Link from "next/link";
import { Bell, Menu, PhoneCall, Search } from "lucide-react";
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
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border glass px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="relative hidden max-w-sm flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search leads, reps, campaigns…"
          className="h-10 w-full rounded-xl border border-border bg-surface/60 pl-9 pr-16 text-sm placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline-flex">
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
              : "Running in demo mode — add Twilio credentials to place live calls"
          }
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {voiceConfigured ? "Twilio Live" : "Demo Mode"}
        </span>

        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger" />
        </button>

        <ThemeToggle />

        <Link
          href="/dialer"
          className={buttonVariants({
            size: "sm",
            className: "hidden gap-2 sm:inline-flex",
          })}
        >
          <PhoneCall className="h-4 w-4" />
          Start Dialing
        </Link>
      </div>
    </header>
  );
}
