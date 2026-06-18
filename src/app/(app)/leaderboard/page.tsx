import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { leaderboard } from "@/lib/data";

export const metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
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
