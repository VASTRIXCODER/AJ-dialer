import { NextResponse } from "next/server";
import { getTeamLeaderboard } from "@/lib/db/metrics";

export const dynamic = "force-dynamic";

/**
 * The leaderboard's refetch endpoint — what the view pulls (debounced) when a
 * `leaderboard.delta` event lands on the org channel. Same data as the server
 * page render: getTeamLeaderboard scopes to the CALLER's session/org itself
 * (unauthenticated ⇒ demo/empty board, never another org's numbers).
 */
export async function GET() {
  return NextResponse.json(await getTeamLeaderboard(), {
    headers: { "cache-control": "no-store" },
  });
}
