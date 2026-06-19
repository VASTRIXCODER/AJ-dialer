"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Wordmark } from "@/components/brand/logo";
import { currentRep } from "@/lib/data";
import { cn } from "@/lib/utils";
import { navGroups } from "./nav";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

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
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                        active
                          ? "bg-primary-soft text-primary shadow-[0_0_24px_-6px_hsl(var(--glow)/0.5)]"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_10px_0_hsl(var(--glow)/0.8)]" />
                      )}
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110",
                          active && "drop-shadow-[0_0_6px_hsl(var(--glow)/0.7)]",
                        )}
                      />
                      <span className="flex-1">{item.label}</span>
                      {item.badge &&
                        (item.badge === "Live" ? (
                          <span className="flex items-center gap-1.5 text-[10px] font-bold text-success">
                            <span className="relative flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                            </span>
                            LIVE
                          </span>
                        ) : (
                          <Badge tone="primary" className="px-1.5 py-0">
                            {item.badge}
                          </Badge>
                        ))}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-3 pb-5">
        <Link
          href="/settings"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background/30 p-3 transition-colors hover:bg-muted/60"
        >
          <Avatar
            initials={currentRep.initials}
            color={currentRep.avatarColor}
            size="sm"
            ring
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{currentRep.name}</p>
            <p className="truncate text-xs capitalize text-muted-foreground">
              {currentRep.team}
            </p>
          </div>
          <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_0_hsl(var(--success)/0.9)]" />
        </Link>
      </div>
    </div>
  );
}
