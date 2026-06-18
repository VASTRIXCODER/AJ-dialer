"use client";

import { Ear, MessageSquare, Phone, Smile, Meh, Frown } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ActiveCall } from "@/lib/types";
import { cn, formatDuration, secondsSince } from "@/lib/utils";

const sentimentMeta = {
  positive: { icon: Smile, tone: "text-success", label: "Positive" },
  neutral: { icon: Meh, tone: "text-muted-foreground", label: "Neutral" },
  negative: { icon: Frown, tone: "text-danger", label: "Negative" },
} as const;

export function MonitorGrid({ calls }: { calls: ActiveCall[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {calls.map((call) => {
        const s = sentimentMeta[call.sentiment];
        const Sentiment = s.icon;
        const dur = secondsSince(call.startedAt, now);
        const connected = call.state === "connected";
        return (
          <Card
            key={call.id}
            className={cn(
              "overflow-hidden p-5 transition-all duration-300 hover:shadow-lift",
              connected && "ring-1 ring-success/20",
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="relative">
                  <Avatar initials={call.repInitials} color={call.repColor} size="md" />
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card",
                      connected
                        ? "bg-success"
                        : call.state === "ringing"
                          ? "bg-warning"
                          : "bg-muted-foreground",
                    )}
                  />
                </span>
                <div>
                  <p className="font-semibold leading-tight">{call.repName}</p>
                  <p className="text-xs text-muted-foreground">{call.campaign}</p>
                </div>
              </div>
              <Badge
                tone={connected ? "success" : call.state === "ringing" ? "warning" : "neutral"}
                dot
                className="capitalize"
              >
                {call.state.replace("_", " ")}
              </Badge>
            </div>

            <div className="mt-4 rounded-xl bg-muted/60 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">{call.leadName}</span>
                </div>
                <span className="font-mono text-sm font-bold tabular text-foreground">
                  {connected ? formatDuration(dur) : "—"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{call.leadCity}</p>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className={cn("flex items-center gap-1.5 text-xs font-medium", s.tone)}>
                <Sentiment className="h-4 w-4" />
                {s.label}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" disabled={!connected}>
                  <Ear className="h-3.5 w-3.5" />
                  Listen
                </Button>
                <Button variant="ghost" size="sm" className="gap-1.5" disabled={!connected}>
                  <MessageSquare className="h-3.5 w-3.5" />
                  Whisper
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
