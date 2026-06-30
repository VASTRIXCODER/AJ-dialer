"use client";

import { AlertTriangle, Loader2, Megaphone, Phone, Settings, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AiLockReason } from "@/lib/org/settings";
import type { Lead } from "@/lib/types";
import { useDialer } from "@/lib/use-dialer";
import { CallStage } from "./call-stage";
import { LeadPanel } from "./lead-panel";
import { QualifyPanel } from "./qualify-panel";

export function DialerClient({
  queue: initialQueue,
  campaigns = [],
  initialCampaign = "",
  voiceConfigured,
  aiAgentConfigured,
  manualEnabled = true,
  aiEnabled = true,
  aiLockReason = null,
  callbackPhone,
  callbackName,
  userId,
}: {
  queue: Lead[];
  campaigns?: { id: string; name: string }[];
  initialCampaign?: string;
  voiceConfigured: boolean;
  aiAgentConfigured: boolean;
  /** Org feature: when false, only AI calling is offered (no manual dialing). */
  manualEnabled?: boolean;
  /** Viewer access: when false, AI calling is locked (premium plan or rep role). */
  aiEnabled?: boolean;
  /** Why AI is locked, to tailor the message ("premium" plan vs "role"). */
  aiLockReason?: AiLockReason;
  /** When set, auto-dial this number (from the Callbacks page "Call back" link). */
  callbackPhone?: string;
  callbackName?: string;
  /** Signed-in user id — keys the persisted "dials today" counter per rep. */
  userId?: string;
}) {
  // The queue is held in state so the "Load leads" button can pull the latest
  // shared pool into the dialer on demand (the page ships an initial copy).
  const [queue, setQueue] = useState<Lead[]>(initialQueue);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);

  async function loadLeads() {
    setLoadingLeads(true);
    setLoadMsg(null);
    try {
      const res = await fetch("/api/leads/queue", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        leads?: Lead[];
        total?: number;
      };
      const leads = Array.isArray(json.leads) ? json.leads : [];
      setQueue(leads);
      if (leads.length) {
        setLoadMsg(`Loaded ${leads.length} lead${leads.length === 1 ? "" : "s"} into the dialer.`);
      } else if ((json.total ?? 0) > 0) {
        setLoadMsg(
          `Found ${json.total} leads, but none are ready to dial yet — they need a New / No-answer / Callback status and a valid phone number.`,
        );
      } else {
        setLoadMsg("No leads found — import a CSV on the Leads tab first.");
      }
    } catch {
      setLoadMsg("Couldn’t load leads. Check your connection and try again.");
    } finally {
      setLoadingLeads(false);
    }
  }

  // Filter the dialing queue to a campaign (client-side; the page ships the full
  // queue). Only changeable between calls so the active session isn't disrupted.
  const [campaignFilter, setCampaignFilter] = useState(
    initialCampaign && campaigns.some((c) => c.id === initialCampaign) ? initialCampaign : "",
  );
  const queueForDialer = campaignFilter
    ? queue.filter((l) => l.campaignId === campaignFilter)
    : queue;
  // AI is usable only when the agent is configured AND this viewer is allowed it.
  const aiUsable = aiAgentConfigured && aiEnabled;
  const dialer = useDialer(queueForDialer, aiUsable, userId);
  const { state } = dialer;

  // Track the rep's in-call notes so they can be saved with the disposition.
  const notesRef = useRef<string>("");
  const focusLeadId = (
    state.connectedLead ??
    state.lines[0]?.lead ??
    (queueForDialer.length ? queueForDialer[state.queueIndex % queueForDialer.length] : null)
  )?.id;
  useEffect(() => {
    const lead = state.connectedLead ??
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
      {manualEnabled && !voiceConfigured && !state.aiMode && (
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
        <span className="text-xs font-medium text-muted-foreground tabular">
          {queueForDialer.length} lead{queueForDialer.length === 1 ? "" : "s"} ready to dial
        </span>
        {campaigns.length > 0 && (
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
              {campaigns.map((c) => (
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
            aiConfigured={aiAgentConfigured}
            manualEnabled={manualEnabled}
            aiEnabled={aiEnabled}
            aiLockReason={aiLockReason}
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
              onNotesChange={(n) => { notesRef.current = n; }}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
