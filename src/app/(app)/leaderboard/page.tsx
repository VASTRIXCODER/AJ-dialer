import { Trophy } from "lucide-react";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";
import { DataStamp } from "@/components/reports/data-stamp";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { getTeamLeaderboard } from "@/lib/db/metrics";
import { getViewer } from "@/lib/org/membership";

export const metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const [data, viewer] = await Promise.all([getTeamLeaderboard(), getViewer()]);

  if (data.reps.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Leaderboard"
          description="Every rep on the floor, ranked by your org's own scoring — today, this calendar week, and this calendar month."
        />
        <EmptyState
          variant="page"
          icon={Trophy}
          title="No ranking yet"
          description="Rankings appear here as your team logs calls and books appointments."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leaderboard"
        description="Every rep on the floor, ranked by your org's own scoring — today, this calendar week, and this calendar month."
      />
      <DataStamp generatedAt={new Date(data.generatedAt)} timezone={data.timezone} />
      <LeaderboardView initialData={data} orgId={viewer.org?.id ?? null} />
    </PageContainer>
  );
}
