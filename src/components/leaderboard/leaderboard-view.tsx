"use client";

import { motion } from "framer-motion";
import { Crown, Medal, TrendingUp } from "lucide-react";
import { useState } from "react";
import { CountUp } from "@/components/motion";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Rep } from "@/lib/types";
import { cn } from "@/lib/utils";

type Period = "daily" | "weekly" | "monthly";

const periods: Array<{ key: Period; label: string }> = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

function metricFor(rep: Rep, period: Period) {
  if (period === "daily")
    return { primary: rep.appointmentsToday, label: "appts", calls: rep.callsToday };
  if (period === "weekly")
    return { primary: rep.appointmentsToday * 5 + 3, label: "appts", calls: rep.callsToday * 5 };
  return { primary: rep.appointmentsToday * 21 + 11, label: "appts", calls: rep.callsToday * 21 };
}

export function LeaderboardView({ reps }: { reps: Rep[] }) {
  const [period, setPeriod] = useState<Period>("weekly");
  const ranked = [...reps].sort(
    (a, b) => metricFor(b, period).primary - metricFor(a, period).primary,
  );
  const [first, second, third] = ranked;
  const podium = [second, first, third];
  const heights = ["h-24", "h-32", "h-20"];
  const place = [2, 1, 3];

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border border-border bg-card p-1">
          {periods.map((p) => {
            const active = period === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "relative rounded-lg px-5 py-2 text-sm font-semibold transition-colors duration-200",
                  active ? "text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="lb-period"
                    className="absolute inset-0 z-0 rounded-lg bg-foreground"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Podium */}
      <div className="mx-auto grid max-w-2xl grid-cols-3 items-end gap-3">
        {podium.map((rep, i) => {
          if (!rep) return <div key={i} />;
          const m = metricFor(rep, period);
          const isFirst = place[i] === 1;
          return (
            <motion.div
              key={`${period}-${rep.id}`}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: i * 0.08, type: "spring", stiffness: 260, damping: 22 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="relative flex flex-col items-center">
                {isFirst && (
                  <motion.span
                    initial={{ opacity: 0, y: 6, rotate: -12 }}
                    animate={{ opacity: 1, y: 0, rotate: 0 }}
                    transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 16 }}
                    className="absolute -top-7"
                  >
                    <Crown className="h-6 w-6 text-warning drop-shadow-[0_0_8px_hsl(var(--warning)/0.6)]" />
                  </motion.span>
                )}
                <Avatar
                  initials={rep.initials}
                  color={rep.avatarColor}
                  size={isFirst ? "lg" : "md"}
                  className={cn(isFirst && "h-16 w-16 text-xl", "ring-4 ring-card")}
                />
                <p className="mt-2 text-center text-sm font-semibold leading-tight">
                  {rep.name.split(" ")[0]}
                </p>
                <p className="text-xs font-bold text-primary tabular">
                  <CountUp value={m.primary} /> {m.label}
                </p>
              </div>
              <div
                className={cn(
                  "flex w-full items-start justify-center rounded-t-xl pt-2 text-lg font-black",
                  heights[i],
                  isFirst
                    ? "bg-solar text-white shadow-[0_-8px_30px_-10px_hsl(var(--glow)/0.7)]"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {place[i]}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Full ranking — rows glide to new positions when the period changes */}
      <Card className="overflow-hidden">
        <div className="border-b border-border p-5">
          <h3 className="font-semibold">Full ranking</h3>
        </div>
        <div className="divide-y divide-border">
          {ranked.map((rep, i) => {
            const m = metricFor(rep, period);
            return (
              <motion.div
                key={rep.id}
                layout
                transition={{ type: "spring", stiffness: 500, damping: 44 }}
                className={cn(
                  "flex items-center gap-4 p-4 transition-colors hover:bg-muted/40",
                  i < 3 && "bg-primary-soft/30",
                )}
              >
                <span className="flex w-8 justify-center">
                  {i < 3 ? (
                    <Medal
                      className={cn(
                        "h-5 w-5",
                        i === 0 ? "text-warning" : i === 1 ? "text-muted-foreground" : "text-primary",
                      )}
                    />
                  ) : (
                    <span className="text-sm font-bold text-muted-foreground tabular">
                      {i + 1}
                    </span>
                  )}
                </span>
                <Avatar initials={rep.initials} color={rep.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{rep.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{rep.team}</p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-bold tabular">
                    <CountUp value={m.calls} />
                  </p>
                  <p className="text-[11px] text-muted-foreground">calls</p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-bold tabular">{rep.connectRate}%</p>
                  <p className="text-[11px] text-muted-foreground">connect</p>
                </div>
                <div className="text-right">
                  <p className="text-base font-black tabular text-primary">
                    <CountUp value={m.primary} />
                  </p>
                  <p className="text-[11px] text-muted-foreground">{m.label}</p>
                </div>
                <Badge tone="success" className="hidden gap-1 md:inline-flex">
                  <TrendingUp className="h-3 w-3" />
                  {rep.score}
                </Badge>
              </motion.div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
