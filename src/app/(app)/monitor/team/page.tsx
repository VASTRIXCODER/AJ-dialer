import { Activity } from "lucide-react";
import { TeamRoster } from "@/components/monitor/team-roster";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { getViewer } from "@/lib/org/membership";

export const metadata = { title: "Team Status" };
export const dynamic = "force-dynamic";

export default async function TeamStatusPage() {
  // Manager-level roster — stricter than Live Monitor (which reps can also
  // open). Enforced here at the page, not just hidden from the nav.
  const viewer = await getViewer();
  if (!viewer.permissions.includes("monitor.roster")) {
    return (
      <PageContainer>
        <PageHeader
          title="Team Status"
          description="Live status for every active rep on your team."
        />
        <EmptyState
          icon={Activity}
          title="Team Status is for supervisors"
          description="Seeing everyone's live status is available to managers and admins. Ask an admin if you need access."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Team Status"
        description="Every active rep, their current call state, and who they're talking to — updating live."
      />
      <TeamRoster orgId={viewer.org?.id ?? null} />
    </PageContainer>
  );
}
