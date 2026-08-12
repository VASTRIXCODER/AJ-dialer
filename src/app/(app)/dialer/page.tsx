import { Headphones, Users } from "lucide-react";
import { DialerClient } from "@/components/dialer/dialer-client";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getCampaigns } from "@/lib/db/pipeline";
import { getDialQueueCount } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import { isSolarVertical } from "@/lib/org/vertical";
import { DEFAULT_FEATURES, resolveDialerAccess } from "@/lib/org/settings";

export const metadata = { title: "Power Dialer" };
export const dynamic = "force-dynamic";

export default async function DialerPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; dial?: string; name?: string }>;
}) {
  // Count only — the queue itself is fetched ONCE client-side via
  // /api/leads/queue (the same path every refetch already uses). Serializing
  // tens of thousands of Lead objects into the RSC payload just to seed a
  // provider that ignores them on every revisit was pure transfer waste.
  const [{ campaign, dial, name }, queueCount, campaigns, viewer] = await Promise.all([
    searchParams,
    getDialQueueCount(),
    getCampaigns(),
    getViewer(),
  ]);
  // Only used for the header badge copy — the dialer engine + its full access
  // gates now live in the app-wide DialerProvider (AppShell).
  const { manualEnabled } = resolveDialerAccess(
    viewer.org?.settings.features ?? DEFAULT_FEATURES,
    viewer.permissions.includes("dialer.ai"),
  );
  const dialCampaigns = campaigns
    .filter((c) => c.status !== "completed")
    // Scripts ride along so the in-call Script card can show the assigned
    // variant without another fetch.
    .map((c) => ({ id: c.id, name: c.name, scriptA: c.scriptA, scriptB: c.scriptB }));

  // Sanitise callback params — only digits/+ allowed in phone to prevent injection.
  const callbackPhone = dial ? dial.replace(/[^\d+]/g, "") : undefined;
  const callbackName = name ? decodeURIComponent(name).slice(0, 80) : undefined;

  return (
    <PageContainer>
      <PageHeader
        title="Power Dialer"
        description={`Browser-based dialing with live ${isSolarVertical(viewer.org?.dialerTemplate) ? "solar " : ""}qualification. No desk phone required.`}
      >
        {queueCount > 0 ? (
          <Badge tone="accent" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {queueCount} in queue
          </Badge>
        ) : (
          <Badge tone="neutral" className="gap-1.5">
            <Headphones className="h-3.5 w-3.5" />
            {manualEnabled ? "Manual dial ready" : "AI agent ready"}
          </Badge>
        )}
      </PageHeader>

      <DialerClient
        queue={[]}
        campaigns={dialCampaigns}
        initialCampaign={campaign ?? ""}
        callbackPhone={callbackPhone}
        callbackName={callbackName}
      />
    </PageContainer>
  );
}
