"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, CalendarCheck, PhoneIncoming, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn, relativeTime } from "@/lib/utils";

type Notif = {
  id: string;
  type: "appointment" | "callback" | "call";
  title: string;
  body: string;
  at: string;
  href: string;
};

const SEEN_KEY = "aiatwork.notif.seen";

const meta = {
  appointment: { icon: CalendarCheck, tone: "bg-success/12 text-success" },
  callback: { icon: PhoneIncoming, tone: "bg-warning/15 text-warning" },
  call: { icon: Sparkles, tone: "bg-accent-soft text-accent" },
} as const;

export function NotificationsBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((j) => setItems(j.notifications ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSeen(Number(localStorage.getItem(SEEN_KEY) ?? 0));
    load();
    const poll = setInterval(load, 30000);
    return () => clearInterval(poll);
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = items.filter((n) => +new Date(n.at) > seen).length;

  function markSeen() {
    const now = Date.now();
    localStorage.setItem(SEEN_KEY, String(now));
    setSeen(now);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) markSeen();
        }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-danger-foreground ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            className="glass absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-border/60 shadow-lift"
          >
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <p className="text-sm font-semibold">Notifications</p>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">You're all caught up.</p>
                </div>
              ) : (
                items.map((n) => {
                  const m = meta[n.type];
                  const Icon = m.icon;
                  return (
                    <Link
                      key={n.id}
                      href={n.href}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-3 border-b border-border/40 px-4 py-3 transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", m.tone)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{n.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{n.body}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                          {n.at ? relativeTime(n.at) : ""}
                        </p>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
