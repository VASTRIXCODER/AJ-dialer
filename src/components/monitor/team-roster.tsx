"use client";

import { Sparkles, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ROLE_LABEL, type OrgRole } from "@/lib/permissions";
import type { PresencePayload } from "@/lib/realtime/events";
import { useOrgChannel } from "@/lib/realtime/use-org-channel";
import type { PresenceStatus } from "@/lib/types";
import { useVisiblePoll } from "@/lib/use-visible-poll";
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

/** Channel-presence claim status → the roster's PresenceStatus vocabulary.
 *  "dialing"/"ai" claims are NOT honored from presence alone — call states are
 *  webhook-driven (the server refetch below carries them), and a claim must
 *  never out-rank the proof. That's the floor merge rule. */
const CLAIM_TO_ROSTER: Record<PresencePayload["status"], PresenceStatus> = {
  available: "idle",
  paused: "idle",
  wrapup: "wrapup",
  dialing: "idle",
  ai: "idle",
};

export function TeamRoster({ orgId = null }: { orgId?: string | null }) {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    fetch("/api/team/presence", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { team: [] }))
      .then((j) => setTeam(j.team ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Realtime-first: call.state pushes refetch the roster (debounced), so the
  // states a manager acts on — live, dialing — move the moment Twilio says so.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLoad = useCallback(() => {
    if (debounceRef.current) return;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      load();
    }, 1000);
  }, [load]);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );
  const { health, presence } = useOrgChannel({
    orgId,
    on: { "call.state": scheduleLoad, "leaderboard.delta": scheduleLoad },
    onResync: load,
  });

  // With a live channel the poll is only a safety net (60s); without one it
  // keeps the old 5s cadence. Paused while hidden; refreshes on return.
  useVisiblePoll(load, health === "live" ? 60_000 : 5000);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Merge channel presence over the server roster, by the floor rule: the
  // server row wins whenever it shows call activity (webhook truth); a channel
  // claim can only refresh an idle-ish row or add someone the server hasn't
  // heard from yet (their tab reports on the channel but a heartbeat hasn't
  // landed). Idle here until E3, when the dialer starts tracking presence.
  const CALL_DRIVEN = new Set<PresenceStatus>(["live", "dialing", "ai"]);
  const merged: TeamMember[] = team.map((m) => {
    const claim = presence.get(m.userId);
    if (!claim || CALL_DRIVEN.has(m.status)) return m;
    return {
      ...m,
      status: CLAIM_TO_ROSTER[claim.status] ?? m.status,
      statusSince: claim.statusSince || m.statusSince,
    };
  });
  const known = new Set(merged.map((m) => m.userId));
  for (const claim of presence.values()) {
    if (known.has(claim.userId)) continue;
    merged.push({
      userId: claim.userId,
      name: claim.name || "Teammate",
      role: "rep",
      status: CLAIM_TO_ROSTER[claim.status] ?? "idle",
      leadName: "",
      leadCity: "",
      leadPhone: "",
      aiActiveCount: 0,
      updatedAt: now,
      statusSince: claim.statusSince || now,
    });
  }

  const activeCount = merged.filter((m) => m.status !== "idle").length;

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
            {merged.length} online{activeCount > 0 ? ` · ${activeCount} on a call` : ""}
          </span>
        )}
      </div>

      {!loading && merged.length === 0 ? (
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
            {merged.map((m) => {
              const meta = STATUS_META[m.status];
              const dur = formatDuration(Math.max(0, Math.floor((now - m.statusSince) / 1000)));
              const showLead = m.status !== "idle";
              return (
                <div key={m.userId} className="flex items-center gap-3 p-4">
                  <span className="relative shrink-0">
                    <Avatar initials={initials(m.name)} seed={m.userId} size="md" />
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
