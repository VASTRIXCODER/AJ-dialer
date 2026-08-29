"use client";

import { useState, type ReactNode } from "react";
import { AiLiveMonitor } from "@/components/monitor/ai-live-monitor";
import { FloorBoard } from "@/components/monitor/floor-board";
import { HumanLiveMonitor } from "@/components/monitor/human-live-monitor";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/tabs";

// ─────────────────────────────────────────────────────────────────────────────
// MonitorShell — the Live Monitor's tab frame. The FLOOR is the primary view
// (the accurate, push-fed command center); the legacy per-channel panels stay
// reachable under "Calls" (they still carry the take-over console and the AI
// KPI strip), and the full archive under "History". `historySlot` is passed in
// from the Server Component page so CallHistory keeps its server-side data
// fetch — panels stay mounted across switches (Tabs uses `hidden`), so state
// survives.
// ─────────────────────────────────────────────────────────────────────────────

export function MonitorShell({
  orgId,
  canListen,
  canIntervene,
  aiConfigured,
  initialCall,
  historySlot,
}: {
  orgId: string | null;
  canListen: boolean;
  canIntervene: boolean;
  aiConfigured: boolean;
  /** A ?call= deep link opens the legacy AI panel's per-call console. */
  initialCall: string | null;
  historySlot: ReactNode;
}) {
  // A deep-linked call lands on the panel that can actually open it.
  const [tab, setTab] = useState(initialCall ? "calls" : "floor");

  return (
    <Tabs value={tab} onChange={setTab} className="space-y-5">
      <TabList label="Live monitor views">
        <Tab value="floor">Floor</Tab>
        <Tab value="calls">Calls</Tab>
        <Tab value="history">History</Tab>
      </TabList>

      <TabPanel value="floor">
        <FloorBoard orgId={orgId} canListen={canListen} canIntervene={canIntervene} />
      </TabPanel>

      <TabPanel value="calls" className="space-y-6">
        {aiConfigured && (
          <AiLiveMonitor
            configured={aiConfigured}
            orgId={orgId}
            initialCall={initialCall}
            canListen={canListen}
            canIntervene={canIntervene}
          />
        )}
        <HumanLiveMonitor canListen={canListen} primary={!aiConfigured} orgId={orgId} />
      </TabPanel>

      <TabPanel value="history">{historySlot}</TabPanel>
    </Tabs>
  );
}
