"use client";

import { AlertTriangle, Settings } from "lucide-react";
import Link from "next/link";
import { AiAgentLauncher } from "@/components/ai/ai-agent-launcher";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { Lead } from "@/lib/types";
import { useDialer } from "@/lib/use-dialer";
import { CallStage } from "./call-stage";
import { LeadPanel } from "./lead-panel";
import { QualifyPanel } from "./qualify-panel";

export function DialerClient({
  queue,
  voiceConfigured,
  aiAgentConfigured,
}: {
  queue: Lead[];
  voiceConfigured: boolean;
  aiAgentConfigured: boolean;
}) {
  const dialer = useDialer(queue);
  const { state } = dialer;

  // Which lead the side panels describe right now (null when the queue is empty
  // and no call is active — production ships with no placeholder lead).
  const focusLead: Lead | null =
    state.connectedLead ??
    state.lines[0]?.lead ??
    (queue.length ? queue[state.queueIndex % queue.length] : null);

  const upNext = queue.length
    ? Array.from({ length: Math.min(4, queue.length - 1) }).map(
        (_, i) => queue[(state.queueIndex + i + 1) % queue.length],
      )
    : [];

  return (
    <div className="space-y-4">
      {!voiceConfigured && (
        <Card className="flex flex-col items-start gap-3 border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Twilio isn’t connected yet</p>
            <p className="text-sm text-muted-foreground">
              Add your Twilio credentials to place live calls. Calling is disabled
              until then — no calls are simulated.
            </p>
          </div>
          <Link
            href="/admin"
            className={buttonVariants({ size: "sm", variant: "outline", className: "gap-2" })}
          >
            <Settings className="h-4 w-4" />
            Connect Twilio
          </Link>
        </Card>
      )}

      <AiAgentLauncher
        leadId={focusLead?.id ?? null}
        leadName={
          focusLead ? `${focusLead.firstName} ${focusLead.lastName}` : "lead"
        }
        configured={aiAgentConfigured}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="overflow-hidden lg:col-span-3">
          <LeadPanel lead={focusLead} upNext={upNext} />
        </Card>

        <Card className="overflow-hidden lg:col-span-5 lg:min-h-[640px]">
          <CallStage
            state={state}
            focusLead={focusLead}
            hasQueue={queue.length > 0}
            onStart={() => dialer.startCall()}
            onManualDial={dialer.dialNumber}
            onEnd={dialer.endCall}
            onSkip={dialer.skip}
            onOutcome={(o) => {
              if (focusLead) {
                void fetch("/api/calls", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    leadId: focusLead.id,
                    leadName: `${focusLead.firstName} ${focusLead.lastName}`,
                    phone: focusLead.phone,
                    durationSec: state.durationSec,
                    outcome: o,
                  }),
                }).catch(() => {});
              }
              dialer.selectOutcome(o);
            }}
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
            <QualifyPanel key={focusLead?.id ?? "none"} lead={focusLead} />
          </div>
        </Card>
      </div>
    </div>
  );
}
