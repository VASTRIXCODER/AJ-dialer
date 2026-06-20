"use client";

import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Wordmark } from "@/components/brand/logo";
import { currentRep } from "@/lib/data";
import { cn } from "@/lib/utils";
import { navGroups } from "./nav";

type Account = { name: string; email: string; initials: string };

export function Sidebar({
  account,
  onNavigate,
}: {
  account?: Account | null;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // Unique per instance so the desktop + mobile sidebars don't share a layout id.
  const uid = useId();
  let order = 0;

  return (
    <div className="glass flex h-full flex-col gap-6 border-r border-border/60">
      <div className="px-5 pt-5">
        <Link href="/dashboard" onClick={onNavigate} className="inline-flex">
          <Wordmark />
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/60">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                const delay = order++ * 0.035;
                return (
                  <motion.li
                    key={item.href}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay,
                      duration: 0.4,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                        active
                          ? "text-primary"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      {active && (
                        <>
                          {/* Sliding active pill — glides between routes */}
                          <motion.span
                            layoutId={`nav-active-${uid}`}
                            className="absolute inset-0 z-0 rounded-xl bg-primary-soft shadow-[0_0_24px_-6px_hsl(var(--glow)/0.5)]"
                            transition={{ type: "spring", stiffness: 420, damping: 34 }}
                          />
                          <motion.span
                            layoutId={`nav-bar-${uid}`}
                            className="absolute left-0 top-1/2 z-10 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_10px_0_hsl(var(--glow)/0.8)]"
                            transition={{ type: "spring", stiffness: 420, damping: 34 }}
                          />
                        </>
                      )}
                      <Icon
                        className={cn(
                          "relative z-10 h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110 group-active:scale-95",
                          active && "drop-shadow-[0_0_6px_hsl(var(--glow)/0.7)]",
                        )}
                      />
                      <span className="relative z-10 flex-1">{item.label}</span>
                      {item.badge &&
                        (item.badge === "Live" ? (
                          <span className="relative z-10 flex items-center gap-1.5 text-[10px] font-bold text-success">
                            <span className="relative flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                            </span>
                            LIVE
                          </span>
                        ) : (
                          <Badge tone="primary" className="relative z-10 px-1.5 py-0">
                            {item.badge}
                          </Badge>
                        ))}
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-2 px-3 pb-5">
        <Link
          href="/settings"
          onClick={onNavigate}
          className="group flex items-center gap-3 rounded-2xl border border-border/60 bg-background/30 p-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-border hover:bg-muted/60 hover:shadow-soft"
        >
          <Avatar
            initials={account?.initials ?? currentRep.initials}
            color={currentRep.avatarColor}
            size="sm"
            ring
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {account?.name ?? currentRep.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {account?.email || (account ? "Signed in" : currentRep.team)}
            </p>
          </div>
          <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_0_hsl(var(--success)/0.9)]" />
        </Link>

        {account && (
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
