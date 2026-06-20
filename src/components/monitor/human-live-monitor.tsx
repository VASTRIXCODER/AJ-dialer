"use client";

import { Phone, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn, formatDuration, formatPhone } from "@/lib/utils";

type HumanCall = {
  id: string;
  leadName: string;
  city: string;
  phone: string;
  state: "ringing" | "connected";
  startedAt: number;
};

/**
 * Live presence for human (manual) calls, polled from /api/calls/active. Renders
 * only while a rep is actually on a call, so it never shows an empty placeholder.
 */
export function HumanLiveMonitor() {
  const [calls, setCalls] = useState<HumanCall[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const load = () =>
      fetch("/api/calls/active")
        .then((r) => r.json())
        .then((j) => setCalls(j.active ?? []))
        .catch(() => {});
    load();
    const poll = setInterval(load, 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  if (calls.length === 0) return null;

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold tracking-tight">Live rep calls</h3>
        <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-success">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          {calls.length} live
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {calls.map((c) => {
          const dur = Math.min(
            Math.max(0, Math.floor((now - c.startedAt) / 1000)),
            60 * 60,
          );
          const connected = c.state === "connected";
          return (
            <Card key={c.id} className="overflow-hidden p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <User className="h-5 w-5" />
                    {connected && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-success" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold leading-tight">{c.leadName}</p>
                    <p className="truncate text-xs text-muted-foreground tabular">
                      {c.city || (c.phone ? formatPhone(c.phone) : "Manual call")}
                    </p>
                  </div>
                </div>
                <Badge tone={connected ? "success" : "warning"} dot>
                  {connected ? "On call" : "Ringing"}
                </Badge>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/60 p-3">
                <span className={cn("flex items-center gap-1.5 text-xs font-medium text-muted-foreground")}>
                  <Phone className="h-4 w-4" />
                  Manual call
                </span>
                <span className="font-mono text-sm font-bold tabular">
                  {formatDuration(dur)}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
