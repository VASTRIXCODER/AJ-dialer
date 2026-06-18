"use client";

import { Card } from "@/components/ui/card";
import type { Lead } from "@/lib/types";
import { useDialer } from "@/lib/use-dialer";
import { CallStage } from "./call-stage";
import { LeadPanel } from "./lead-panel";
import { QualifyPanel } from "./qualify-panel";

export function DialerClient({ queue }: { queue: Lead[] }) {
  const dialer = useDialer(queue);
  const { state } = dialer;

  // Which lead the side panels should describe right now.
  const focusLead: Lead | null =
    state.connectedLead ??
    state.lines[0]?.lead ??
    queue[state.queueIndex % queue.length] ??
    null;

  const upNext = Array.from({ length: 4 }).map(
    (_, i) => queue[(state.queueIndex + i + 1) % queue.length],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card className="overflow-hidden lg:col-span-3">
        <LeadPanel lead={focusLead} upNext={upNext} />
      </Card>

      <Card className="overflow-hidden lg:col-span-5 lg:min-h-[640px]">
        <CallStage
          state={state}
          focusLead={focusLead}
          onStart={() => dialer.startCall()}
          onEnd={dialer.endCall}
          onSkip={dialer.skip}
          onOutcome={dialer.selectOutcome}
          onToggleMute={dialer.toggleMute}
          onToggleHold={dialer.toggleHold}
          onToggleRecording={dialer.toggleRecording}
          onDigit={dialer.sendDigit}
          onSetParallel={dialer.setParallelCount}
          onSetAutoDial={dialer.setAutoDial}
        />
      </Card>

      <Card className="overflow-hidden lg:col-span-4">
        <div className="border-b border-border px-5 py-3">
          <h3 className="font-semibold">Solar resolution workflow</h3>
          <p className="text-xs text-muted-foreground">
            Qualify the homeowner & capture the account review
          </p>
        </div>
        <div className="p-5">
          <QualifyPanel lead={focusLead} />
        </div>
      </Card>
    </div>
  );
}
