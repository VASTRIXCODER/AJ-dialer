"use client";

import { AnimatePresence } from "framer-motion";
import { MapPin, Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar, type AvatarTone } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DensityToggle } from "@/components/ui/density-toggle";
import { useDensity } from "@/components/layout/density";
import { LaneCard } from "@/components/ui/lane-card";
import { StatusPill } from "@/components/ui/status-pill";
import {
  isLaneEnded,
  laneStateToPill,
  laneTerminationReason,
  type LaneStatus,
} from "@/lib/dialer/lane-state";
import { inferNumberLocation } from "@/lib/leads/area-code";
import type { DialLine } from "@/lib/use-dialer";
import { cn, formatDuration, formatPhone, initials } from "@/lib/utils";
import { useDialerContext } from "./dialer-context";

// ─────────────────────────────────────────────────────────────────────────────
// ParallelLanes (E4) — the parallel dialing workspace. One LaneCard per line:
// who's being rung (name, city, "number location (inferred)" — the area-code
// inference, always labeled as such), the campaign chip, the canonical
// StatusPill + a per-lane state timer, a pulse dot on every state change, and
// the termination reason once a lane ends. A connected lane renders focused;
// the losers collapse into the released rail (`variant="rail"` — the same
// component the live cockpit composes underneath itself).
//
// Timers are computed HERE, on this device, from when we observed each state
// change — the engine's DialLine carries no timestamps — so the stats strip
// says so instead of dressing them up as server truth.
//
// Phone-duplicate lanes never reach this component: the engine drops them
// before dialing (src/lib/dialer/lane-dedupe.ts) and the provider toasts.
// ─────────────────────────────────────────────────────────────────────────────

const tones: AvatarTone[] = ["chart-1", "chart-2", "chart-3"];
/** How long the event pulse dot stays lit after a lane's state changes. */
const PULSE_MS = 1_800;

interface LaneMeta {
  status: LaneStatus;
  /** When THIS device observed the lane enter its current state (ms epoch). */
  since: number;
  changedAt: number;
}

/** Track per-lane state-change times locally (the engine carries none). */
function useLaneMeta(lines: DialLine[]): {
  metaFor: (id: string) => LaneMeta | undefined;
  now: number;
} {
  const metaRef = useRef<Map<string, LaneMeta>>(new Map());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const at = Date.now();
    const ids = new Set(lines.map((l) => l.id));
    for (const id of [...metaRef.current.keys()]) {
      if (!ids.has(id)) metaRef.current.delete(id);
    }
    for (const line of lines) {
      const meta = metaRef.current.get(line.id);
      if (!meta) {
        metaRef.current.set(line.id, { status: line.status, since: at, changedAt: at });
      } else if (meta.status !== line.status) {
        metaRef.current.set(line.id, { status: line.status, since: at, changedAt: at });
      }
    }
  }, [lines]);

  return { metaFor: (id) => metaRef.current.get(id), now };
}

function LaneRow({
  line,
  index,
  meta,
  now,
  campaignName,
  compact,
  anotherAnswered,
}: {
  line: DialLine;
  index: number;
  meta: LaneMeta | undefined;
  now: number;
  campaignName: string | null;
  compact: boolean;
  anotherAnswered: boolean;
}) {
  const name = `${line.lead.firstName} ${line.lead.lastName}`.trim();
  const loc = inferNumberLocation(line.lead.phone);
  const ended = isLaneEnded(line.status);
  const reason = laneTerminationReason(line.status, {
    anotherAnswered,
    refusal: line.refusal,
  });
  const elapsedSec = Math.max(0, Math.floor((now - (meta?.since ?? now)) / 1000));
  const pulsing = Boolean(meta && now - meta.changedAt < PULSE_MS);

  return (
    <LaneCard
      compact={compact}
      focused={line.status === "connected"}
      className={cn(ended && "opacity-60")}
      header={
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar
            initials={initials(name || formatPhone(line.lead.phone))}
            tone={line.status === "connected" ? "success" : tones[index % tones.length]}
            size={compact ? "sm" : "md"}
          />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
              <span className="truncate">{name || formatPhone(line.lead.phone)}</span>
              {/* Marks the lane that just changed state. It used to ping —
                  a scale(2) transform — on a row carrying a name, a number and
                  a running timer. Colour alone now. */}
              {pulsing && (
                <span
                  className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                  aria-hidden
                />
              )}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 truncate text-xs text-muted-foreground">
              <span className="tabular">{formatPhone(line.lead.phone)}</span>
              {line.lead.city && (
                <span className="truncate">
                  · {line.lead.city}, {line.lead.state}
                </span>
              )}
            </p>
            {!compact && loc && (
              <p
                className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3"
                title="Inferred from the phone number's area code — numbers are portable, so this is about the NUMBER, not necessarily where they live."
              >
                <MapPin className="h-3 w-3 shrink-0" />
                {loc.region}, {loc.state} · number location (inferred)
              </p>
            )}
          </div>
        </div>
      }
      statusPill={<StatusPill state={laneStateToPill(line.status)} />}
      timer={
        !ended ? (
          <span className="text-xs font-semibold text-muted-foreground tabular">
            {formatDuration(elapsedSec)}
          </span>
        ) : undefined
      }
      body={
        ended && reason ? (
          <p className="text-xs font-medium text-muted-foreground">{reason}</p>
        ) : !compact && campaignName ? (
          <Badge tone="outline" className="max-w-full">
            <span className="truncate">{campaignName}</span>
          </Badge>
        ) : undefined
      }
    />
  );
}

export function ParallelLanes({
  lines,
  variant = "round",
  className,
}: {
  lines: DialLine[];
  /** "round" = the full dialing workspace (header, stats, density toggle).
   *  "rail" = the compact released rail the live cockpit composes underneath
   *  itself — just the (non-connected) lanes, no chrome. */
  variant?: "round" | "rail";
  className?: string;
}) {
  const { dialer, campaigns } = useDialerContext();
  const { state } = dialer;
  // The workspace setting, not a private one. This used to remember its own
  // answer under "aj:density:dialer-lanes", so a rep who tightened the floor
  // found the lanes unchanged.
  const { density, setDensity } = useDensity();
  const { metaFor, now } = useLaneMeta(lines);

  const anotherAnswered =
    lines.some((l) => l.status === "connected") || state.status === "live";
  const shown = variant === "rail" ? lines.filter((l) => l.status !== "connected") : lines;
  const compact = variant === "rail" || density === "compact";

  if (!shown.length) return null;

  const campaignNameFor = (campaignId: string): string | null =>
    campaigns.find((c) => c.id === campaignId)?.name ?? null;

  return (
    <div className={cn("w-full", className)}>
      {variant === "round" && (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {lines.length} line{lines.length === 1 ? "" : "s"} this round
              {state.callerIdInfo?.callerId && (
                <span className="flex items-center gap-1 font-medium normal-case tracking-normal">
                  <Phone className="h-3 w-3" />
                  from {formatPhone(state.callerIdInfo.callerId)}
                </span>
              )}
            </p>
            <DensityToggle
              value={density}
              onChange={setDensity}
            />
          </div>
          {/* Session stats — every number here is counted in THIS browser
              session (the engine's own counters), and says so. */}
          <p className="mb-2.5 text-[11px] text-muted-foreground tabular">
            <b className="font-bold text-foreground">{state.callsThisSession}</b> dials ·{" "}
            <b className="font-bold text-foreground">{state.connectsThisSession}</b> connects{" "}
            <span className="text-ink-3">
              this session, counted on this device
            </span>
          </p>
        </>
      )}
      {variant === "rail" && (
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Released lines
        </p>
      )}
      <div className={compact ? "space-y-1.5" : "space-y-2.5"}>
        <AnimatePresence initial={false}>
          {shown.map((line, i) => (
            <LaneRow
              key={line.id}
              line={line}
              index={i}
              meta={metaFor(line.id)}
              now={now}
              campaignName={line.lead.campaignId ? campaignNameFor(line.lead.campaignId) : null}
              compact={compact}
              anotherAnswered={anotherAnswered}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
