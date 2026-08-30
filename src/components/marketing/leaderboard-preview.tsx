"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CELL } from "@/lib/ui-density";

type Row = {
  name: string;
  initials: string;
  color: string;
  calls: number;
  convos: number;
  appts: number;
  sales: number;
  conv: number;
};

const rows: Row[] = [
  { name: "Sarah Chen", initials: "SC", color: "212 100% 62%", calls: 143, convos: 61, appts: 11, sales: 6, conv: 18 },
  { name: "Marcus Reid", initials: "MR", color: "190 95% 55%", calls: 128, convos: 54, appts: 9, sales: 5, conv: 17 },
  { name: "Priya Nair", initials: "PN", color: "260 85% 68%", calls: 117, convos: 49, appts: 8, sales: 4, conv: 16 },
  { name: "Dana Ellis", initials: "DE", color: "158 64% 46%", calls: 104, convos: 41, appts: 6, sales: 3, conv: 15 },
  { name: "Leo Martins", initials: "LM", color: "36 95% 58%", calls: 96, convos: 37, appts: 5, sales: 3, conv: 14 },
];

const cols = [
  { key: "calls", label: "Calls" },
  { key: "convos", label: "Conversations" },
  { key: "appts", label: "Appointments" },
  { key: "sales", label: "Sales" },
  { key: "conv", label: "Conversion" },
] as const;

export function LeaderboardPreview() {
  const reduce = useReducedMotion();
  return (
    <div className="overflow-hidden rounded-3xl border border-border/80 bg-card/80 shadow-lift backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white">
            <Crown className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold">Team Leaderboard</span>
        </div>
        <span className="rounded-full bg-muted/70 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          This week
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className={cn(CELL, "font-semibold")}>Rep</th>
              {cols.map((c) => (
                <th key={c.key} className="px-4 py-3 text-right font-semibold">
                  {c.label}
                </th>
              ))}
              <th className={cn(CELL, "text-right font-semibold")}>Rank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <motion.tr
                key={r.name}
                initial={reduce ? false : { opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
                className={cn(
                  "border-b border-border/40 last:border-0",
                  i === 0 && "bg-primary-soft/30",
                )}
              >
                <td className={cn(CELL)}>
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: `hsl(${r.color})` }}
                    >
                      {r.initials}
                    </span>
                    <span className="text-sm font-semibold">{r.name}</span>
                  </div>
                </td>
                <td className={cn(CELL, "text-right text-sm font-medium tabular")}>{r.calls}</td>
                <td className={cn(CELL, "text-right text-sm font-medium tabular")}>{r.convos}</td>
                <td className={cn(CELL, "text-right text-sm font-medium tabular")}>{r.appts}</td>
                <td className={cn(CELL, "text-right text-sm font-medium tabular")}>{r.sales}</td>
                <td className={cn(CELL, "text-right text-sm font-bold tabular text-primary")}>
                  {r.conv}%
                </td>
                <td className={cn(CELL, "text-right")}>
                  <span
                    className={cn(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold",
                      i === 0
                        ? "bg-warning/20 text-warning"
                        : "bg-muted/70 text-muted-foreground",
                    )}
                  >
                    #{i + 1}
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
