"use client";

import { Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ROLE_LABEL, type OrgRole } from "@/lib/permissions";
import type { PresenceStatus } from "@/lib/types";
import { cn, formatDuration, formatPhone, initials } from "@/lib/utils";

type TeamMember = {
  userId: string;
  name: string;
  role: OrgRole;
  status: PresenceStatus;
  leadName: string;
  leadCity: string;
  leadPhone: string;
  aiActiveCount: number;
  updatedAt: number;
  statusSince: number;
};

const STATUS_META: Record<
  PresenceStatus,
  { label: string; tone: "neutral" | "warning" | "success" | "accent" | "primary"; dot?: boolean }
> = {
  idle: { label: "Idle", tone: "neutral" },
  dialing: { label: "Dialing…", tone: "warning", dot: true },
  live: { label: "Live", tone: "success", dot: true },
  wrapup: { label: "Wrap-up", tone: "accent" },
  ai: { label: "AI dialing", tone: "primary", dot: true },
};

// A small fixed palette, deterministically assigned by user id — matches the
// avatarColor look used elsewhere (leaderboard, sample data) without needing
// the roster API to carry a stored color.
const PALETTE = [
  "#3B82F6",
  "#0EA5E9",
  "#8B5CF6",
  "#10B981",
  "#EC4899",
  "#F59E0B",
  "#06B6D4",
  "#EF4444",
];
function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function TeamRoster() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const load = () =>
      fetch("/api/team/presence", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { team: [] }))
        .then((j) => setTeam(j.team ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    load();
    const poll = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const activeCount = team.filter((m) => m.status !== "idle").length;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold tracking-tight">Active now</h3>
        {!loading && (
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
              activeCount > 0 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
            )}
          >
            {activeCount > 0 && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
            )}
            {team.length} online{activeCount > 0 ? ` · ${activeCount} on a call` : ""}
          </span>
        )}
      </div>

      {!loading && team.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Users className="h-6 w-6" />
          </span>
          <div>
            <p className="font-semibold">No one is actively dialing right now</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Reps show up here the moment they open the dialer, and update live
              as their call state changes.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {team.map((m) => {
              const meta = STATUS_META[m.status];
              const dur = formatDuration(Math.max(0, Math.floor((now - m.statusSince) / 1000)));
              const showLead = m.status !== "idle";
              return (
                <div key={m.userId} className="flex items-center gap-3 p-4">
                  <span className="relative shrink-0">
                    <Avatar initials={initials(m.name)} color={colorForId(m.userId)} size="md" />
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                        m.status === "idle" ? "bg-muted-foreground/50" : "bg-success",
                      )}
                    />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold leading-tight">{m.name}</p>
                      <Badge tone="outline" className="shrink-0">
                        {ROLE_LABEL[m.role] ?? m.role}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {m.status === "ai" ? (
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          AI · {m.aiActiveCount} in progress
                        </span>
                      ) : showLead && m.leadName ? (
                        <>
                          {m.leadName}
                          {m.leadCity ? ` · ${m.leadCity}` : ""}
                          {!m.leadCity && m.leadPhone ? ` · ${formatPhone(m.leadPhone)}` : ""}
                        </>
                      ) : (
                        "Not on a call"
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {showLead && (
                      <span className="font-mono text-xs font-bold tabular text-muted-foreground">
                        {dur}
                      </span>
                    )}
                    <Badge tone={meta.tone} dot={meta.dot}>
                      {meta.label}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </section>
  );
}
