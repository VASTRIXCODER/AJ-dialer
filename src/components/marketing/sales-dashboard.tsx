"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarCheck,
  MessageSquare,
  PhoneCall,
  TrendingUp,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CountUp } from "@/components/motion";
import { cn } from "@/lib/utils";

const tiles = [
  { icon: Users, label: "Active reps", value: 18, tone: "text-primary", live: true },
  { icon: PhoneCall, label: "Calls in progress", value: 7, tone: "text-accent", live: true },
  { icon: CalendarCheck, label: "Appointments today", value: 42, tone: "text-success", live: false },
  { icon: MessageSquare, label: "Conversations", value: 128, tone: "text-primary", live: false },
];

const board = [
  { name: "Sarah Chen", initials: "SC", calls: 143, appts: 11, color: "212 100% 62%" },
  { name: "Marcus Reid", initials: "MR", calls: 128, appts: 9, color: "190 95% 55%" },
  { name: "Priya Nair", initials: "PN", calls: 117, appts: 8, color: "260 85% 68%" },
];

const campaigns = [
  { name: "Q2 Outbound", pct: 82 },
  { name: "Renewals", pct: 64 },
  { name: "Web Leads", pct: 47 },
];

const feed = [
  "Sarah booked an appointment · Q2 Outbound",
  "Marcus connected a call in 1.8s",
  "Priya marked 3 follow-ups",
  "New lead list imported · 420 leads",
  "Dana moved to #4 on the leaderboard",
];

export function SalesDashboard() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setTick((n) => (n + 1) % feed.length), 2600);
    return () => clearInterval(t);
  }, [reduce]);

  return (
    <div className="relative w-full max-w-xl">
      <div className="absolute -inset-8 -z-10 rounded-[2.5rem] bg-brand opacity-20 blur-[90px]" />

      <div className="overflow-hidden rounded-3xl border border-border/80 bg-card/80 shadow-lift backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white">
              <TrendingUp className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-semibold">Live Sales Floor</span>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-[11px] font-bold text-success">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-success"
              animate={reduce ? {} : { opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
            LIVE
          </span>
        </div>

        <div className="space-y-4 p-5">
          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((t) => (
              <div
                key={t.label}
                className="rounded-2xl border border-border/60 bg-surface/60 p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60", t.tone)}>
                    <t.icon className="h-4 w-4" />
                  </span>
                  {t.live && (
                    <motion.span
                      className="h-1.5 w-1.5 rounded-full bg-accent"
                      animate={reduce ? {} : { opacity: [1, 0.25, 1] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                  )}
                </div>
                <p className="mt-2.5 text-2xl font-black tracking-tight tabular">
                  <CountUp value={t.value} />
                </p>
                <p className="text-xs text-muted-foreground">{t.label}</p>
              </div>
            ))}
          </div>

          {/* Leaderboard + campaigns */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/60 bg-surface/60 p-3.5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Leaderboard
              </p>
              <div className="space-y-2">
                {board.map((r, i) => (
                  <div key={r.name} className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                        i === 0
                          ? "bg-warning/20 text-warning"
                          : "bg-muted/70 text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: `hsl(${r.color})` }}
                    >
                      {r.initials}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{r.name}</span>
                    <span className="shrink-0 text-xs font-bold tabular text-foreground">{r.calls}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-surface/60 p-3.5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Campaigns
              </p>
              <div className="space-y-2.5">
                {campaigns.map((c, i) => (
                  <div key={c.name}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-medium text-muted-foreground">{c.name}</span>
                      <span className="font-bold tabular text-muted-foreground">{c.pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted/70">
                      <motion.div
                        className="h-full rounded-full bg-brand"
                        initial={reduce ? false : { width: 0 }}
                        whileInView={{ width: `${c.pct}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.9, delay: 0.15 * i, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Live activity ticker */}
          <div className="flex items-center gap-2.5 rounded-2xl border border-accent/25 bg-accent-soft/40 px-3.5 py-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <motion.span
                className="h-1.5 w-1.5 rounded-full bg-accent"
                animate={reduce ? {} : { scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </span>
            <div className="relative h-4 flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.p
                  key={tick}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 truncate text-xs font-medium text-muted-foreground"
                >
                  {feed[tick]}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
