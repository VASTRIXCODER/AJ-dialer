import { Trophy } from "lucide-react";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { getReportingData } from "@/lib/db/metrics";

export const metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const { leaderboard } = await getReportingData();

  if (leaderboard.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Leaderboard"
          description="Friendly competition that drives the floor — ranked by appointments, contact rate, and performance score."
        />
        <EmptyState
          icon={Trophy}
          title="No ranking yet"
          description="Rankings appear here as you log calls and book appointments."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leaderboard"
        description="Friendly competition that drives the floor — ranked by appointments, contact rate, and performance score."
      />
      <LeaderboardView reps={leaderboard} />
    </PageContainer>
  );
}
