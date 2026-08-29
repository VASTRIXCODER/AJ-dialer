"use client";

import { useState } from "react";
import { RealtimeHealth } from "@/components/ui/realtime-health";
import { useOrgChannel } from "@/lib/realtime/use-org-channel";

/**
 * The monitor header's connection pill: subscribes to the org floor channel
 * (the SAME shared socket the boards below use — the module-level registry in
 * use-org-channel ref-counts, so this adds a listener, not a connection) and
 * reports whether the page is push-fed or riding its poll fallback.
 * (E2 re-places this when the monitor is rebuilt.)
 */
export function MonitorRealtimeStatus({ orgId }: { orgId: string | null }) {
  // State (not a ref): floor events are sparse — one cheap pill re-render per
  // event keeps the tooltip's "last update" honest.
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const note = () => setLastEventAt(Date.now());
  const { health } = useOrgChannel({
    orgId,
    on: {
      "call.state": note,
      "call.answered": note,
      "leaderboard.delta": note,
      "transcript.segment": note,
      "review.created": note,
    },
  });
  return <RealtimeHealth health={health} lastEventAt={lastEventAt} />;
}
