import { Trophy } from "lucide-react";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { getTeamLeaderboard } from "@/lib/db/metrics";

export const metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const { reps, meId } = await getTeamLeaderboard();

  if (reps.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Leaderboard"
          description="Every rep on the floor, ranked by appointments, connect rate, and performance score — across today, this week, and this month."
        />
        <EmptyState
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
        description="Every rep on the floor, ranked by appointments, connect rate, and performance score — across today, this week, and this month."
      />
      <LeaderboardView reps={reps} meId={meId} />
    </PageContainer>
  );
}
