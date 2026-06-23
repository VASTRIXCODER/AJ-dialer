"use client";

import { AlertTriangle, Megaphone, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { Lead } from "@/lib/types";
import { useDialer } from "@/lib/use-dialer";
import { CallStage } from "./call-stage";
import { LeadPanel } from "./lead-panel";
import { QualifyPanel } from "./qualify-panel";

export function DialerClient({
  queue,
  campaigns = [],
  initialCampaign = "",
  voiceConfigured,
  aiAgentConfigured,
}: {
  queue: Lead[];
  campaigns?: { id: string; name: string }[];
  initialCampaign?: string;
  voiceConfigured: boolean;
  aiAgentConfigured: boolean;
}) {
  // Filter the dialing queue to a campaign (client-side; the page ships the full
  // queue). Only changeable between calls so the active session isn't disrupted.
  const [campaignFilter, setCampaignFilter] = useState(
    initialCampaign && campaigns.some((c) => c.id === initialCampaign) ? initialCampaign : "",
  );
  const queueForDialer = campaignFilter
    ? queue.filter((l) => l.campaignId === campaignFilter)
    : queue;
  const dialer = useDialer(queueForDialer, aiAgentConfigured);
  const { state } = dialer;

  // Which lead the side panels describe right now (null when the queue is empty
  // and no call is active — production ships with no placeholder lead).
  const focusLead: Lead | null =
    state.connectedLead ??
    state.lines[0]?.lead ??
    (queueForDialer.length ? queueForDialer[state.queueIndex % queueForDialer.length] : null);

  const upNext = queueForDialer.length
    ? Array.from({ length: Math.min(4, queueForDialer.length - 1) }).map(
        (_, i) => queueForDialer[(state.queueIndex + i + 1) % queueForDialer.length],
      )
    : [];

  return (
    <div className="space-y-4">
      {/* Manual mode needs Twilio; AI mode places calls server-side without it. */}
      {!voiceConfigured && !state.aiMode && (
        <Card className="flex flex-col items-start gap-3 border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Twilio isn’t connected yet</p>
            <p className="text-sm text-muted-foreground">
              Manual dialing needs your Twilio credentials. Switch to AI calling, or
              connect Twilio to dial manually.
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

      {campaigns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Megaphone className="h-4 w-4" />
            Campaign
          </span>
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            disabled={state.status !== "idle"}
            className="h-9 rounded-xl border border-border bg-background/60 px-2.5 text-sm font-medium transition-colors focus-visible:border-primary/50 focus-visible:outline-none disabled:opacity-50"
          >
            <option value="">All leads</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {queueForDialer.length} lead{queueForDialer.length === 1 ? "" : "s"} queued
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="overflow-hidden lg:col-span-3">
          <LeadPanel
            lead={focusLead}
            upNext={upNext}
            queue={queueForDialer}
            index={queueForDialer.length ? state.queueIndex % queueForDialer.length : 0}
            total={queueForDialer.length}
            onPrev={dialer.prevLead}
            onNext={dialer.nextLead}
            onSelect={dialer.selectLead}
            navDisabled={state.status !== "idle"}
          />
        </Card>

        <Card className="overflow-hidden lg:col-span-5 lg:min-h-[640px]">
          <CallStage
            state={state}
            focusLead={focusLead}
            hasQueue={queueForDialer.length > 0}
            aiConfigured={aiAgentConfigured}
            onStart={() => dialer.startCall()}
            onManualDial={dialer.dialNumber}
            onAiDialNumber={dialer.aiDialNumber}
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
            onSetAiMode={dialer.setAiMode}
            onLaunchNextAI={dialer.launchNextAI}
            onStopAICampaign={dialer.stopAICampaign}
            onEndAISession={dialer.endAISession}
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
