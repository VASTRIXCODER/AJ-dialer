"use client";

import { useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/tabs";
import type { LeadPanel } from "@/lib/db/lead-360";
import type { TimelineItem } from "@/lib/db/lead-timeline";
import { AiSummarySection } from "./ai-summary-section";
import { AutomationSection } from "./automation-section";
import { CustomFieldsSection } from "./custom-fields-section";
import { DncSection } from "./dnc-section";
import { OpportunitySection } from "./opportunity-section";
import { LocationSection } from "./location-section";
import { NotesSection } from "./notes-section";
import { OwnershipSection } from "./ownership-section";
import { RecordingsSection } from "./recordings-section";
import { PanelSection } from "./section-shell";
import { TimelineSection } from "./timeline-section";

/**
 * The Lead 360 body — identical in the drawer and on /leads/[id] (both hand it
 * a server-assembled panel + first timeline page). Three tabs keep a dense
 * record navigable; panels stay mounted across switches so a half-typed note
 * or an expanded timeline survives.
 */
export function Lead360Content({
  panel,
  timeline,
  onRefresh,
}: {
  panel: LeadPanel;
  timeline: TimelineItem[];
  /** Called after an inline save so the host re-fetches fresh data. */
  onRefresh?: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const dncHistory = timeline.filter((t) => t.kind === "dnc");

  return (
    <Tabs value={tab} onChange={setTab}>
      <TabList label="Lead record sections">
        <Tab value="overview">Overview</Tab>
        <Tab value="activity">Activity</Tab>
        <Tab value="automation">Automation</Tab>
        <Tab value="recordings">Recordings</Tab>
      </TabList>

      <TabPanel value="overview" className="mt-4">
        <div className="space-y-4">
          <OwnershipSection panel={panel} />
          <OpportunitySection opportunity={panel.opportunity} />
          <DncSection panel={panel} history={dncHistory} />
          <LocationSection panel={panel} />
          <AiSummarySection summary={panel.aiSummary} />
          <CustomFieldsSection fields={panel.fields} />
          <PanelSection title="Notes">
            <NotesSection
              leadId={panel.lead.id}
              notes={panel.lead.notes ?? ""}
              onSaved={onRefresh}
            />
          </PanelSection>
        </div>
      </TabPanel>

      <TabPanel value="activity" className="mt-4">
        <TimelineSection leadId={panel.lead.id} initial={timeline} />
      </TabPanel>

      {/* `active` is threaded, not decorative: TabPanel renders its children
          whether or not the tab is selected, so without it this body would
          fetch on every Lead 360 open — including the drawer over a live call. */}
      <TabPanel value="automation" className="mt-4">
        <AutomationSection leadId={panel.lead.id} active={tab === "automation"} />
      </TabPanel>

      <TabPanel value="recordings" className="mt-4">
        <RecordingsSection recordings={panel.recordings} />
      </TabPanel>
    </Tabs>
  );
}
