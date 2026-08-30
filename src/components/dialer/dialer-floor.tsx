"use client";

import { ChevronDown, PhoneCall, Radio } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDialerContextOptional } from "@/components/dialer/dialer-context";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useOrgChannel } from "@/lib/realtime/use-org-channel";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { cn, initials } from "@/lib/utils";

interface FloorDialer {
  id: string;
  name: string;
  callsToday: number;
  live: { state: "ringing" | "connected"; leadName: string } | null;
}
interface Snapshot {
  dialers: FloorDialer[];
  totalCallsToday: number;
  activeCount: number;
  meId: string | null;
}

/**
 * Shared "live floor" on the power dialer: who's dialing right now and how many
 * calls each teammate has made today, org-wide. Polls /api/floor every few
 * seconds. Counts come from call_records (the same source as reports/leaderboard)
 * so they're consistent for everyone — not the per-device session counter.
 */
export function DialerFloor() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(false);
  // Rendered under DialerProvider on the dialer page; optional so the strip
  // stays harmless if it's ever mounted outside the shell (no org → no channel).
  const orgId = useDialerContextOptional()?.config.orgId ?? null;

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(() => {
    void (async () => {
      try {
        const r = await fetch("/api/floor", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as Snapshot;
        if (alive.current) setData(j);
      } catch {
        /* transient — keep the last snapshot */
      }
    })();
  }, []);

  // Realtime-first: every call.state / leaderboard.delta broadcast refetches
  // the strip (debounced — a parallel round fires several in one second).
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
  const { health } = useOrgChannel({
    orgId,
    on: { "call.state": scheduleLoad, "leaderboard.delta": scheduleLoad },
    onResync: load,
  });

  // Display-only poll — a 60s safety net while the channel is live, the old 5s
  // cadence otherwise. Paused while the tab is hidden (the dial engine's own
  // intervals in use-dialer.ts are untouched and keep running during calls).
  useVisiblePoll(load, health === "live" ? 60_000 : 5000);

  // Nothing to show until there's activity today (keeps a fresh org's dialer clean).
  if (!data || (data.dialers.length === 0 && data.totalCallsToday === 0)) return null;

  // Your own authoritative calls-today (from call_records — matches Reports).
  const myCallsToday = data.dialers.find((d) => d.id === data.meId)?.callsToday ?? 0;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Radio className={cn("h-4 w-4", data.activeCount > 0 ? "text-success" : "text-muted-foreground")} />
          Live floor
        </span>
        {data.activeCount > 0 ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-success">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            {data.activeCount} dialing now
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Nobody dialing right now</span>
        )}
        <span
          className="ml-auto flex items-center gap-3 text-xs text-muted-foreground"
          title="Calls logged today, from your call records — the same source as Reports."
        >
          <span>
            <b className="font-bold text-foreground tabular">{myCallsToday}</b> yours
          </span>
          <span>
            <b className="font-bold text-foreground tabular">{data.totalCallsToday}</b> team today
          </span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="max-h-64 divide-y divide-border/60 overflow-y-auto border-t border-border/60">
          {data.dialers.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2">
              <Avatar initials={initials(d.name) || "—"} seed={d.id} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {d.name}
                  {d.id === data.meId && <span className="text-primary"> (You)</span>}
                </p>
                {d.live ? (
                  <p className="flex items-center gap-1.5 truncate text-xs text-success">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                    </span>
                    {d.live.state === "connected" ? "On a call" : "Dialing"}
                    {d.live.leadName ? ` · ${d.live.leadName}` : ""}
                  </p>
                ) : (
                  <p className="truncate text-xs text-muted-foreground">Idle</p>
                )}
              </div>
              <span className="flex items-center gap-1 text-sm font-semibold tabular text-muted-foreground">
                <PhoneCall className="h-3.5 w-3.5" />
                {d.callsToday}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
