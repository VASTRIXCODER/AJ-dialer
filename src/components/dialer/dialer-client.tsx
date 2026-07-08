"use client";

import { AlertTriangle, Loader2, Megaphone, Phone, Settings, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Lead } from "@/lib/types";
import { CallStage } from "./call-stage";
import { useDialerContext } from "./dialer-context";
import { DialerFloor } from "./dialer-floor";
import { LeadPanel } from "./lead-panel";
import { QualifyPanel } from "./qualify-panel";

export function DialerClient({
  queue: initialQueue,
  campaigns = [],
  initialCampaign = "",
  callbackPhone,
  callbackName,
}: {
  queue: Lead[];
  campaigns?: { id: string; name: string }[];
  initialCampaign?: string;
  /** When set, auto-dial this number (from the Callbacks page "Call back" link). */
  callbackPhone?: string;
  callbackName?: string;
}) {
  // The dialer engine now lives ABOVE the page (in AppShell's DialerProvider) so
  // a live call survives navigating between sections. This page consumes it.
  const {
    dialer,
    config,
    queueForDialer,
    campaignFilter,
    setCampaignFilter,
    campaigns: ctxCampaigns,
    loadLeads,
    loadingLeads,
    loadMsg,
    activate,
  } = useDialerContext();
  const { state } = dialer;

  // Seed the provider with this page's server data + switch the engine on. Runs
  // once; the provider keeps the device + any live call alive after we leave.
  const activatedRef = useRef(false);
  useEffect(() => {
    if (activatedRef.current) return;
    activatedRef.current = true;
    activate(initialQueue, campaigns, initialCampaign);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const campaignsForSelect = ctxCampaigns.length ? ctxCampaigns : campaigns;

  // Track the rep's in-call notes so they can be saved with the disposition.
  const notesRef = useRef<string>("");
  const focusLeadId = (
    state.connectedLead ??
    state.lines[0]?.lead ??
    (queueForDialer.length ? queueForDialer[state.queueIndex % queueForDialer.length] : null)
  )?.id;
  useEffect(() => {
    const lead =
      state.connectedLead ??
      state.lines[0]?.lead ??
      (queueForDialer.length ? queueForDialer[state.queueIndex % queueForDialer.length] : null);
    notesRef.current = lead?.notes ?? "";
    // Reset notes to the lead's saved notes whenever the active lead changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLeadId]);

  // Auto-dial a callback number as soon as the Twilio device is live and idle.
  const callbackFiredRef = useRef(false);
  useEffect(() => {
    if (!callbackPhone || callbackFiredRef.current) return;
    if (state.mode === "live" && state.status === "idle" && !state.aiMode) {
      callbackFiredRef.current = true;
      dialer.dialNumber(callbackPhone, callbackName);
    }
  }, [state.mode, state.status, state.aiMode, callbackPhone, callbackName, dialer]);

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
      {config.manualEnabled && !config.voiceConfigured && !state.aiMode && (
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

      {/* Callback auto-dial banner — shown until the call fires */}
      {callbackPhone && !callbackFiredRef.current && state.status === "idle" && (
        <Card className="flex flex-col items-start gap-3 border-accent/30 bg-accent/5 p-4 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Phone className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              Callback ready{callbackName ? ` — ${callbackName}` : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              {state.mode === "live"
                ? "Dialing now…"
                : "Connecting to Twilio — will dial automatically once ready."}
            </p>
          </div>
        </Card>
      )}

      {/* Load leads into the dialer on demand + campaign filter */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={loadLeads}
          disabled={loadingLeads || state.status !== "idle"}
        >
          {loadingLeads ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Users className="h-4 w-4" />
          )}
          Load leads
        </Button>
        <span
          className="text-xs font-medium text-muted-foreground tabular"
          title="The power dialer only ever loads leads you uploaded — you never dial a teammate's leads."
        >
          <b className="text-foreground">{queueForDialer.length}</b> of your lead
          {queueForDialer.length === 1 ? "" : "s"} ready to dial
        </span>
        {campaignsForSelect.length > 0 && (
          <>
            <span className="ml-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
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
              {campaignsForSelect.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}
        {loadMsg && (
          <span className="basis-full text-xs text-muted-foreground">{loadMsg}</span>
        )}
      </div>

      {/* Shared live floor — who's dialing + calls today, org-wide */}
      <DialerFloor />

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
            onLoadLeads={loadLeads}
            loadingLeads={loadingLeads}
          />
        </Card>

        <Card className="overflow-hidden lg:col-span-5 lg:min-h-[640px]">
          <CallStage
            state={state}
            focusLead={focusLead}
            hasQueue={queueForDialer.length > 0}
            aiConfigured={config.aiAgentConfigured}
            manualEnabled={config.manualEnabled}
            aiEnabled={config.aiEnabled}
            aiLockReason={config.aiLockReason}
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
                    callSid: state.callSid,
                    room: state.room,
                    notes: notesRef.current || undefined,
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
            onReconnect={dialer.reconnect}
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
            <QualifyPanel
              key={focusLead?.id ?? "none"}
              lead={focusLead}
              onNotesChange={(n) => {
                notesRef.current = n;
              }}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
