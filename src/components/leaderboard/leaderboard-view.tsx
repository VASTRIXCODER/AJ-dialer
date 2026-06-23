"use client";

import { motion } from "framer-motion";
import { Crown, Flame, Medal, PhoneCall, Target, TrendingUp, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { CountUp } from "@/components/motion";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { LeaderboardEntry, LeaderboardStat } from "@/lib/types";
import { cn } from "@/lib/utils";

type Period = "daily" | "weekly" | "monthly";
type RankBy = "appointments" | "score" | "connects" | "calls";

const PERIODS: { key: Period; label: string }[] = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
];

const RANKS: { key: RankBy; label: string }[] = [
  { key: "appointments", label: "Appointments" },
  { key: "score", label: "Score" },
  { key: "connects", label: "Connects" },
  { key: "calls", label: "Calls" },
];

const ROLE_TONE: Record<string, "primary" | "accent" | "warning" | "neutral"> = {
  owner: "primary",
  admin: "accent",
  manager: "warning",
  rep: "neutral",
};

const statFor = (r: LeaderboardEntry, p: Period): LeaderboardStat => r[p];
const rankVal = (s: LeaderboardStat, by: RankBy) =>
  by === "appointments" ? s.appointments : by === "connects" ? s.connects : by === "calls" ? s.calls : s.score;

function Segmented<T extends string>({
  options,
  value,
  onChange,
  layoutId,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  layoutId: string;
}) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-card p-1">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "relative rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 sm:text-sm",
              active ? "text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 z-0 rounded-lg bg-foreground"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative z-10 whitespace-nowrap">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  suffix,
  tone,
}: {
  icon: typeof PhoneCall;
  label: string;
  value: number;
  suffix?: string;
  tone: "primary" | "accent" | "success" | "warning";
}) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    accent: "bg-accent-soft text-accent",
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning",
  } as const;
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tabular">
          <CountUp value={value} />
          {suffix}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function SplitBar({ ai, human }: { ai: number; human: number }) {
  const total = ai + human;
  if (total === 0) return null;
  const aiPct = Math.round((ai / total) * 100);
  return (
    <div
      className="mt-1 flex h-1 w-24 overflow-hidden rounded-full bg-muted"
      title={`${ai} AI · ${human} human`}
    >
      <span className="bg-solar" style={{ width: `${aiPct}%` }} />
      <span className="bg-accent" style={{ width: `${100 - aiPct}%` }} />
    </div>
  );
}

export function LeaderboardView({
  reps,
  meId = null,
}: {
  reps: LeaderboardEntry[];
  meId?: string | null;
}) {
  const [period, setPeriod] = useState<Period>("weekly");
  const [rankBy, setRankBy] = useState<RankBy>("appointments");

  const ranked = [...reps].sort((a, b) => {
    const sa = statFor(a, period);
    const sb = statFor(b, period);
    return (
      rankVal(sb, rankBy) - rankVal(sa, rankBy) ||
      sb.score - sa.score ||
      sb.calls - sa.calls
    );
  });

  // Period totals across the floor.
  const totals = ranked.reduce(
    (acc, r) => {
      const s = statFor(r, period);
      acc.calls += s.calls;
      acc.connects += s.connects;
      acc.appts += s.appointments;
      if (s.calls > 0) acc.active += 1;
      return acc;
    },
    { calls: 0, connects: 0, appts: 0, active: 0 },
  );
  const teamConnect = totals.calls ? Math.round((totals.connects / totals.calls) * 100) : 0;

  const [first, second, third] = ranked;
  const podium = [second, first, third];
  const heights = ["h-24", "h-32", "h-20"];
  const place = [2, 1, 3];
  const rankLabel = RANKS.find((r) => r.key === rankBy)!.label.toLowerCase();

  return (
    <div className="space-y-6">
      {/* Team totals for the period */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={PhoneCall} label="Dials" value={totals.calls} tone="primary" />
        <SummaryCard icon={Flame} label="Connect rate" value={teamConnect} suffix="%" tone="accent" />
        <SummaryCard icon={Target} label="Appointments" value={totals.appts} tone="success" />
        <SummaryCard icon={Users} label="Active reps" value={totals.active} tone="warning" />
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <Segmented options={PERIODS} value={period} onChange={setPeriod} layoutId="lb-period" />
        <div className="flex items-center gap-2">
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">Rank by</span>
          <Segmented options={RANKS} value={rankBy} onChange={setRankBy} layoutId="lb-rank" />
        </div>
      </div>

      {/* Podium */}
      {ranked.length > 0 && (
        <div className="mx-auto grid max-w-2xl grid-cols-3 items-end gap-3">
          {podium.map((rep, i) => {
            if (!rep) return <div key={i} />;
            const s = statFor(rep, period);
            const isFirst = place[i] === 1;
            return (
              <motion.div
                key={`${period}-${rankBy}-${rep.id}`}
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
                    {rep.id === meId && <span className="text-primary"> (You)</span>}
                  </p>
                  <p className="text-xs font-bold text-primary tabular">
                    <CountUp value={rankVal(s, rankBy)} /> {rankLabel}
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
      )}

      {/* Full ranking */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h3 className="font-semibold">Full ranking</h3>
          <span className="text-xs text-muted-foreground">{ranked.length} on the floor</span>
        </div>
        {/* Column header (desktop) */}
        <div className="hidden items-center gap-4 border-b border-border/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:flex">
          <span className="w-8 text-center">#</span>
          <span className="flex-1">Rep</span>
          <span className="w-16 text-right">Calls</span>
          <span className="w-16 text-right">Connect</span>
          <span className="w-16 text-right">Talk</span>
          <span className="w-16 text-right">Appts</span>
          <span className="w-16 text-right">Conv</span>
          <span className="w-14 text-right">Score</span>
        </div>
        <div className="divide-y divide-border">
          {ranked.map((rep, i) => {
            const s = statFor(rep, period);
            const me = rep.id === meId;
            return (
              <motion.div
                key={rep.id}
                layout
                transition={{ type: "spring", stiffness: 500, damping: 44 }}
                className={cn(
                  "flex items-center gap-4 p-4 transition-colors hover:bg-muted/40",
                  i < 3 && "bg-primary-soft/20",
                  me && "ring-1 ring-inset ring-primary/40",
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
                    <span className="text-sm font-bold text-muted-foreground tabular">{i + 1}</span>
                  )}
                </span>
                <Avatar initials={rep.initials} color={rep.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold">
                    {rep.name}
                    {me && (
                      <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        YOU
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge tone={ROLE_TONE[rep.role] ?? "neutral"} className="capitalize">
                      {rep.role}
                    </Badge>
                    <SplitBar ai={s.aiCalls} human={s.humanCalls} />
                  </div>
                </div>
                <div className="hidden w-16 text-right lg:block">
                  <p className="text-sm font-bold tabular">
                    <CountUp value={s.calls} />
                  </p>
                </div>
                <div className="hidden w-16 text-right sm:block">
                  <p className="text-sm font-bold tabular">{s.connectRate}%</p>
                  <p className="text-[11px] text-muted-foreground lg:hidden">connect</p>
                </div>
                <div className="hidden w-16 text-right lg:block">
                  <p className="text-sm font-bold tabular">{s.talkTimeMin}m</p>
                </div>
                <div className="w-16 text-right">
                  <p className="text-base font-black tabular text-primary">
                    <CountUp value={s.appointments} />
                  </p>
                  <p className="text-[11px] text-muted-foreground lg:hidden">appts</p>
                </div>
                <div className="hidden w-16 text-right lg:block">
                  <p className="text-sm font-bold tabular">{s.conversionRate}%</p>
                </div>
                <div className="w-14 text-right">
                  <Badge tone="success" className="gap-1">
                    <TrendingUp className="h-3 w-3" />
                    {s.score}
                  </Badge>
                </div>
              </motion.div>
            );
          })}
        </div>
        {ranked.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Trophy className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No one on the floor yet</p>
            <p className="text-sm text-muted-foreground">
              Rankings appear as your team logs calls and books appointments.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
