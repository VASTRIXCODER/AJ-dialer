import { Headphones, Users } from "lucide-react";
import { DialerClient } from "@/components/dialer/dialer-client";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getAssignment } from "@/lib/db/assignments";
import { getCampaigns } from "@/lib/db/pipeline";
import { getDialQueueCount } from "@/lib/db/leads";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";
import { isSolarVertical } from "@/lib/org/vertical";
import { DEFAULT_FEATURES, resolveDialerAccess } from "@/lib/org/settings";

export const metadata = { title: "Power Dialer" };
export const dynamic = "force-dynamic";

export default async function DialerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Count only — the queue itself is fetched ONCE client-side via
  // /api/leads/queue (the same path every refetch already uses). Serializing
  // tens of thousands of Lead objects into the RSC payload just to seed a
  // provider that ignores them on every revisit was pure transfer waste.
  const [sp, queueCount, campaigns, viewer] = await Promise.all([
    searchParams,
    getDialQueueCount(),
    getCampaigns(),
    getViewer(),
  ]);
  // A repeated query param arrives as an array — take the first, never crash.
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const campaign = one(sp.campaign);
  const dial = one(sp.dial);
  const name = one(sp.name);
  // ?assignment= — a "Continue" click from My Assignments. Resolve the pack
  // label server-side (getAssignment re-checks the caller may see it); an
  // unresolvable id simply drops the scope rather than erroring the dialer.
  const assignmentParam = one(sp.assignment);
  let assignment: { id: string; label: string } | null = null;
  if (assignmentParam) {
    const scope = await getScope();
    if (scope) {
      const record = await getAssignment(scope, assignmentParam);
      if (record) assignment = { id: record.id, label: record.label };
    }
  }
  // Only used for the header badge copy — the dialer engine + its full access
  // gates now live in the app-wide DialerProvider (AppShell).
  const { manualEnabled } = resolveDialerAccess(
    viewer.org?.settings.features ?? DEFAULT_FEATURES,
    viewer.permissions.includes("dialer.ai"),
  );
  const dialCampaigns = campaigns
    .filter((c) => c.status !== "completed")
    // Scripts ride along so the in-call Script card can show the assigned
    // variant without another fetch; disposition_keys ride along so the wrap-up
    // grid can narrow to the campaign's own subset.
    .map((c) => ({
      id: c.id,
      name: c.name,
      scriptA: c.scriptA,
      scriptB: c.scriptB,
      dispositionKeys: c.dispositionKeys,
      // The AI session header shows the campaign's goal while the agent dials.
      objective: c.objective,
    }));

  // Sanitise callback params — only digits/+ allowed in phone to prevent injection.
  const callbackPhone = dial ? dial.replace(/[^\d+]/g, "") : undefined;
  const callbackName = name ? decodeURIComponent(name).slice(0, 80) : undefined;
  // ?callback=<uuid> — the Callbacks board's claim→dial deep link. Riding it
  // onto the disposition is what finally CLOSES the callback when the call is
  // filed. Strictly a uuid; anything else is dropped, never forwarded.
  const callbackParam = one(sp.callback);
  const callbackId =
    callbackParam &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callbackParam)
      ? callbackParam
      : undefined;

  return (
    <PageContainer>
      <PageHeader
        title="Power Dialer"
        description="Browser-based dialing with live qualification. No desk phone required."
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
        // The org's stored disposition taxonomy — the wrap-up grid renders the
        // admin's own buttons (resolved client-side; absent = the canonical 9).
        dispositions={viewer.org?.settings.dispositions ?? null}
        initialCampaign={campaign ?? ""}
        callbackPhone={callbackPhone}
        callbackName={callbackName}
        callbackId={callbackId}
        assignmentId={assignment?.id}
        assignmentLabel={assignment?.label}
      />
    </PageContainer>
  );
}
