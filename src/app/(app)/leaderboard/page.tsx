import { Trophy } from "lucide-react";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { leaderboard } from "@/lib/data";

export const metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
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
          description="Rep rankings appear here as your team logs calls and books appointments."
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
