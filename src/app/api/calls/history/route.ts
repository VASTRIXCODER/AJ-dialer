import { NextResponse } from "next/server";
import { getCallHistory } from "@/lib/db/metrics";

export const dynamic = "force-dynamic";

/**
 * Paginated full call history — every logged call (with recording + transcript
 * access), scoped to the viewer (supervisors org-wide, reps their own). Backs
 * the Reports "Call history" section's "Load more".
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const page = await getCallHistory({ offset, limit });
  return NextResponse.json(page);
}
