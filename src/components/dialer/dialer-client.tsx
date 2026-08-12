"use client";

import {
  AlertTriangle,
  CalendarCheck2,
  ChevronDown,
  ListFilter,
  Loader2,
  Phone,
  PhoneCall,
  ScrollText,
  Settings,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  isScriptTestRunning,
  scriptTextForVariant,
  scriptVariantForLead,
} from "@/lib/campaign-scripts";
import {
  persistDisposition,
  replayQueuedDispositions,
} from "@/lib/dialer/disposition-queue";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { cn } from "@/lib/utils";
import type { BookedLead } from "@/lib/db/leads";
import type { CallOutcome, Lead } from "@/lib/types";
import { BookAppointmentDialog, type BookedAppointment } from "./book-appointment-dialog";
import { BookedLeadsPanel } from "./booked-leads-panel";
import { CallStage } from "./call-stage";
import { useDialerContext, type DialerCampaign } from "./dialer-context";
import { DialerFloor } from "./dialer-floor";
import { LeadPanel } from "./lead-panel";
import { groupLabel, LoadLeadsDialog } from "./load-leads-dialog";
import { QualifyPanel } from "./qualify-panel";

export function DialerClient({
  queue: initialQueue,
  campaigns = [],
  initialCampaign = "",
  callbackPhone,
  callbackName,
}: {
  queue: Lead[];
  campaigns?: DialerCampaign[];
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
    queue,
    queueForDialer,
    campaignFilter,
    setCampaignFilter,
    groupFilter,
    setGroupFilter,
    myLeadsOnly,
    setMyLeadsOnly,
    campaigns: ctxCampaigns,
    loadLeads,
    loadingLeads,
    loadMsg,
    activate,
  } = useDialerContext();
  const { state } = dialer;
  const [showLoadDialog, setShowLoadDialog] = useState(false);

  // ── Booked tab ────────────────────────────────────────────────────────────
  // Leads with an appointment already on the calendar. getDialQueue already
  // excludes them from the dial queue (status "appointment" isn't in DIALABLE),
  // so this is purely a visibility tab — polling independently of the dial
  // engine, the same pattern DialerFloor uses.
  const [tab, setTab] = useState<"queue" | "booked">("queue");
  const [bookedLeads, setBookedLeads] = useState<BookedLead[]>([]);
  const [bookedLoading, setBookedLoading] = useState(true);
  const bookedAlive = useRef(true);
  useEffect(() => {
    bookedAlive.current = true;
    return () => {
      bookedAlive.current = false;
    };
  }, []);
  // Display-only poll — paused while the tab is hidden. The dial engine's own
  // intervals (use-dialer.ts) are untouched and keep running during calls.
  useVisiblePoll(() => {
    void (async () => {
      try {
        const r = await fetch("/api/leads/booked", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json().catch(() => ({}))) as { leads?: BookedLead[] };
        if (bookedAlive.current) setBookedLeads(Array.isArray(j.leads) ? j.leads : []);
      } catch {
        /* transient — keep the last snapshot */
      } finally {
        if (bookedAlive.current) setBookedLoading(false);
      }
    })();
  }, 15000);

  // How many of the currently-loaded leads this viewer personally uploaded —
  // powers the toggle's badge so a supervisor knows what to expect before
  // clicking it (e.g. not worth toggling if it'd show 0).
  const mineCount = useMemo(
    () =>
      config.userId
        ? queue.filter(
            (l) => l.ownerId === config.userId || l.assignedRepId === config.userId,
          ).length
        : 0,
    [queue, config.userId],
  );

  // Seed the provider with this page's server data + switch the engine on. Runs
  // once; the provider keeps the device + any live call alive after we leave.
  const activatedRef = useRef(false);
  useEffect(() => {
    if (activatedRef.current) return;
    activatedRef.current = true;
    activate(initialQueue, campaigns, initialCampaign);
    // The page no longer serializes the queue into the RSC payload (it ships
    // ONCE as JSON via /api/leads/queue instead of twice) — so fetch it here,
    // unless the provider still holds a queue from an earlier visit.
    if (initialQueue.length === 0 && queue.length === 0) void loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const campaignsForSelect = ctxCampaigns.length ? ctxCampaigns : campaigns;

  // Track the rep's in-call notes so they can be saved with the disposition.
  const notesRef = useRef<string>("");
  // The script variant (A/B) shown for the focus lead — same ref idiom as
  // notesRef, so the disposition POST can carry it without re-binding
  // fileOutcome on every render. Updated by an effect further down, once the
  // focus lead + its campaign are resolved.
  const scriptVariantRef = useRef<"a" | "b" | null>(null);
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

  // Flush any dispositions that failed to save on a previous (flaky) session.
  useEffect(() => {
    void replayQueuedDispositions();
  }, []);

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

  // ── Campaign script (A/B test) ─────────────────────────────────────────────
  // Which script the focus lead's campaign assigns them. Deterministic per lead
  // (hash of the id), so the same homeowner hears the same script on every
  // attempt. No script on the campaign ⇒ nothing renders at all.
  const focusCampaign = focusLead?.campaignId
    ? campaignsForSelect.find((c) => c.id === focusLead.campaignId)
    : undefined;
  const focusScripts = focusCampaign
    ? { scriptA: focusCampaign.scriptA ?? "", scriptB: focusCampaign.scriptB ?? "" }
    : null;
  const scriptVariant =
    focusLead && focusScripts ? scriptVariantForLead(focusLead, focusScripts) : null;
  const scriptText = focusScripts ? scriptTextForVariant(focusScripts, scriptVariant) : "";
  const scriptTestRunning = focusScripts ? isScriptTestRunning(focusScripts) : false;
  const [scriptOpen, setScriptOpen] = useState(true);
  useEffect(() => {
    scriptVariantRef.current = scriptVariant;
  }, [scriptVariant]);

  // ── Disposition ────────────────────────────────────────────────────────────
  // "Appointment booked" pauses here to ask WHEN, because filing the disposition
  // is a one-way door: dialer.selectOutcome() advances the queue and, with
  // auto-dial on, immediately starts calling the next homeowner. Ask first, file
  // second. Every other outcome files straight through, untouched.
  const [booking, setBooking] = useState<{ lead: Lead; notes: string } | null>(null);

  const fileOutcome = useCallback(
    (o: CallOutcome, lead: Lead | null, appointment?: BookedAppointment | null) => {
      if (lead) {
        // Durable: on any network failure the disposition is queued in
        // localStorage and replayed on the next load, instead of being silently
        // dropped while the queue advances. Advance immediately for snappy UX.
        void persistDisposition({
          leadId: lead.id,
          leadName: `${lead.firstName} ${lead.lastName}`,
          phone: lead.phone,
          durationSec: state.durationSec,
          outcome: o,
          callSid: state.callSid,
          room: state.room,
          notes: notesRef.current || undefined,
          appointment: appointment ?? undefined,
          // Which script (A/B) the rep was shown for this lead — powers the
          // per-variant split on the campaign page. Absent when no script.
          scriptVariant: scriptVariantRef.current ?? undefined,
        });
      }
      dialer.selectOutcome(o);
    },
    [dialer, state.durationSec, state.callSid, state.room],
  );

  const onOutcome = useCallback(
    (o: CallOutcome) => {
      if (o === "appointment_booked" && focusLead) {
        setBooking({ lead: focusLead, notes: notesRef.current });
        return;
      }
      fileOutcome(o, focusLead);
    },
    [focusLead, fileOutcome],
  );

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

      {/* Dial queue vs already-booked leads — booked leads are skipped by the
          queue automatically; this tab is where they're visible instead of
          just vanishing on the next reload. */}
      <div className="flex items-center gap-1.5 border-b border-border/60">
        <button
          type="button"
          onClick={() => setTab("queue")}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab === "queue"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <PhoneCall className="h-4 w-4" />
          Dial queue
        </button>
        <button
          type="button"
          onClick={() => setTab("booked")}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab === "booked"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <CalendarCheck2 className="h-4 w-4" />
          Booked
          <Badge tone={tab === "booked" ? "success" : "neutral"} className="ml-0.5">
            {bookedLeads.length}
          </Badge>
        </button>
      </div>

      {/* Shared live floor — who's dialing + calls today, org-wide */}
      <DialerFloor />

      {tab === "booked" ? (
        <Card className="overflow-hidden">
          <BookedLeadsPanel leads={bookedLeads} loading={bookedLoading} />
        </Card>
      ) : (
        <>
      {/* Load leads into the dialer on demand + the group/campaign picker */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={async () => {
            const fresh = await loadLeads();
            if (fresh.length) setShowLoadDialog(true);
          }}
          disabled={loadingLeads || state.status !== "idle"}
        >
          {loadingLeads ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Users className="h-4 w-4" />
          )}
          Load leads
        </Button>
        {queue.length > 0 && (
          <button
            type="button"
            onClick={() => setShowLoadDialog(true)}
            disabled={state.status !== "idle"}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background/60 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            title="Choose which lead group or campaign to dial"
          >
            <ListFilter className="h-4 w-4" />
            Filters
          </button>
        )}
        {groupFilter !== "all" && (
          <Badge tone="primary" className="gap-1">
            {groupLabel(groupFilter, config.leadGroupLabels, config.leadGroups)}
            <button
              type="button"
              onClick={() => setGroupFilter("all")}
              aria-label="Clear group filter"
              className="ml-0.5 hover:opacity-70"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
        {campaignFilter && (
          <Badge tone="accent" className="gap-1">
            {campaignsForSelect.find((c) => c.id === campaignFilter)?.name ?? "Campaign"}
            <button
              type="button"
              onClick={() => setCampaignFilter("")}
              aria-label="Clear campaign filter"
              className="ml-0.5 hover:opacity-70"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
        {config.dialScope === "org" && (
          <button
            type="button"
            onClick={() => setMyLeadsOnly(!myLeadsOnly)}
            disabled={state.status !== "idle"}
            aria-pressed={myLeadsOnly}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-50",
              myLeadsOnly
                ? "border-primary/60 bg-primary-soft text-primary"
                : "border-border bg-background/60 text-muted-foreground hover:bg-muted",
            )}
            title={
              myLeadsOnly
                ? "Showing only your leads (ones you uploaded or were assigned). Click to include the whole organization's pool again."
                : "Only load your leads — ones you uploaded or were assigned. Your choice is remembered next time."
            }
          >
            <UserCheck className="h-4 w-4" />
            My leads only
            <Badge tone={myLeadsOnly ? "primary" : "neutral"} className="ml-0.5">
              {mineCount}
            </Badge>
          </button>
        )}
        <span
          className="text-xs font-medium text-muted-foreground tabular"
          title={
            config.dialScope === "org" && !myLeadsOnly
              ? "As a supervisor you dial the whole organization's pool — every rep's leads, not just your own uploads."
              : "The power dialer only ever loads leads you uploaded — you never dial a teammate's leads."
          }
        >
          <b className="text-foreground">{queueForDialer.length}</b>{" "}
          {config.dialScope === "org" && !myLeadsOnly ? "org" : "of your"} lead
          {queueForDialer.length === 1 ? "" : "s"} ready to dial
        </span>
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
            showSolarPayment={config.qualifyShowSolarPayment !== false}
          />
        </Card>

        <Card className="overflow-hidden lg:col-span-5 lg:min-h-[640px]">
          <CallStage
            state={state}
            focusLead={focusLead}
            hasQueue={queueForDialer.length > 0}
            wrapupNotes={notesRef.current}
            aiConfigured={config.aiAgentConfigured}
            manualEnabled={config.manualEnabled}
            aiEnabled={config.aiEnabled}
            aiLockReason={config.aiLockReason}
            secondAgentConfigured={config.secondAgentConfigured ?? false}
            agentNames={config.agentNames}
            onSetActiveAgent={dialer.setActiveAgent}
            callerIdPool={config.callerIdPool ?? []}
            callerIdRotateEvery={config.callerIdRotateEvery ?? 1}
            onToggleExcludedCallerId={dialer.toggleExcludedCallerId}
            onStart={() => dialer.startCall()}
            onManualDial={dialer.dialNumber}
            onAiDialNumber={dialer.aiDialNumber}
            onEnd={dialer.endCall}
            onSkip={dialer.skip}
            onOutcome={onOutcome}
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
            <h3 className="font-semibold">
              {config.qualifyShowSolarPayment !== false
                ? "Solar resolution workflow"
                : "Qualification workflow"}
            </h3>
            <p className="text-xs text-muted-foreground">
              Qualify the lead & capture the account review
            </p>
          </div>
          {scriptText.length > 0 && (
            <div className="border-b border-border">
              <button
                type="button"
                onClick={() => setScriptOpen((v) => !v)}
                aria-expanded={scriptOpen}
                className="flex w-full items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <ScrollText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Script</span>
                {scriptTestRunning && scriptVariant && (
                  <Badge tone={scriptVariant === "a" ? "primary" : "accent"}>
                    Variant {scriptVariant.toUpperCase()}
                  </Badge>
                )}
                <ChevronDown
                  className={cn(
                    "ml-auto h-4 w-4 text-muted-foreground transition-transform",
                    scriptOpen && "rotate-180",
                  )}
                />
              </button>
              {scriptOpen && (
                <div className="max-h-56 overflow-y-auto px-5 pb-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {scriptText}
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="p-5">
            <QualifyPanel
              key={focusLead?.id ?? "none"}
              lead={focusLead}
              showSolarPayment={config.qualifyShowSolarPayment !== false}
              otherLabel={config.qualifyOtherLabel || "Battery"}
              onNotesChange={(n) => {
                notesRef.current = n;
              }}
            />
          </div>
        </Card>
      </div>
        </>
      )}

      {booking && (
        <BookAppointmentDialog
          lead={booking.lead}
          defaultNotes={booking.notes}
          onConfirm={(appt) => {
            setBooking(null);
            fileOutcome("appointment_booked", booking.lead, appt);
          }}
          onSkip={() => {
            // Books it with no time — the pre-existing behavior. It lands in the
            // calendar's "Needs a time" rail rather than being silently lost.
            setBooking(null);
            fileOutcome("appointment_booked", booking.lead);
          }}
          // Backing out files nothing at all: the rep mis-clicked, and the call
          // stays open on the same lead.
          onCancel={() => setBooking(null)}
        />
      )}

      {showLoadDialog && (
        <LoadLeadsDialog
          leads={queue}
          campaigns={campaignsForSelect}
          campaignFilter={campaignFilter}
          onCampaignFilterChange={setCampaignFilter}
          groupFilter={groupFilter}
          onGroupFilterChange={setGroupFilter}
          onClose={() => setShowLoadDialog(false)}
          leadGroupLabels={config.leadGroupLabels}
          leadGroups={config.leadGroups}
        />
      )}
    </div>
  );
}
