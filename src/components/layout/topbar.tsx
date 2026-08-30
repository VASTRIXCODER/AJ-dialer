"use client";

import Link from "next/link";
import { Menu, PhoneCall, Search, Sparkles } from "lucide-react";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { Z } from "@/lib/z-layers";

// ─────────────────────────────────────────────────────────────────────────────
// The header is chrome. It reports state (AI, Twilio, notifications), opens the
// palette, and gets out of the way — the page owns the primary action.
//
// Three things it was getting wrong:
//   · The sticky element was a transparent wrapper with 12–16px of padding, so
//     page rows scrolled visibly through the band above the floating header.
//     The opaque fill is on the sticky element now.
//   · The command palette's only trigger was `hidden … sm:flex`, and the other
//     way in is ⌘K, which a phone cannot produce. The palette was mounted on
//     every page and unreachable on every phone.
//   · "Start Dialing" was a brand-filled primary pill that also translated
//     toward the cursor. It stays — a one-click way to the dialer from any
//     screen is real utility — but as a quiet outline control, so it stops
//     competing with the actual primary action of whatever page is beneath it.
// ─────────────────────────────────────────────────────────────────────────────

export function Topbar({
  onMenuClick,
  voiceConfigured,
  aiConfigured,
}: {
  onMenuClick: () => void;
  voiceConfigured: boolean;
  aiConfigured: boolean;
}) {
  const openPalette = () => window.dispatchEvent(new Event("open-command-palette"));

  return (
    <div
      className="sticky top-0 bg-background px-3 pt-3 sm:px-5 sm:pt-4"
      style={{ zIndex: Z.topbar }}
    >
      <header className="glass flex h-[60px] items-center gap-3 rounded-2xl border border-border/60 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Universal search / command palette */}
        <button
          type="button"
          onClick={openPalette}
          className="group relative hidden max-w-md flex-1 items-center sm:flex"
        >
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-hover:text-primary" />
          <span className="h-10 w-full rounded-xl border border-border/70 bg-surface-2 pl-10 pr-16 text-left text-sm leading-10 text-ink-3 transition-colors duration-[var(--dur-state)] group-hover:border-primary/40 group-hover:bg-muted">
            Search or ask AI…
          </span>
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground md:inline-flex">
            ⌘K
          </kbd>
        </button>

        <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
          {/* The palette's only door on a phone. ⌘K is not producible there. */}
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search or ask AI"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
          >
            <Search className="h-4 w-4" />
          </button>

          <span
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold lg:inline-flex",
              aiConfigured
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border/70 bg-muted/50 text-muted-foreground",
            )}
            title={
              aiConfigured
                ? "Claude is powering live intelligence"
                : "AI is running in demo mode — add ANTHROPIC_API_KEY for live Claude intelligence"
            }
          >
            <Sparkles className="h-3 w-3" />
            {aiConfigured ? "Claude" : "Demo AI"}
          </span>

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

          <NotificationsBell />

          <ThemeToggle />

          <Link
            href="/dialer"
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "hidden gap-2 sm:inline-flex",
            })}
          >
            <PhoneCall className="h-4 w-4" />
            Start Dialing
          </Link>
        </div>
      </header>
    </div>
  );
}
