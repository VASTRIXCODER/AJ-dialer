import { NextResponse } from "next/server";
import { getSegmentReport } from "@/lib/db/session-builder";

export const dynamic = "force-dynamic";

/**
 * Exact, uncapped per-segment lead counts for the session builder.
 *
 * These are COUNT queries, not array lengths — which matters, because every other
 * total in this product used to be an array length and PostgREST silently caps
 * arrays at 1,000 rows. The old dialer reported "1000 leads" against a book of
 * 16,636 and the operator planned campaigns from that number.
 */
export async function GET(req: Request) {
  // ?orgWide=1 — supervisors planning an org-wide session (server-verified;
  // reps are silently own-scoped by getSegmentReport).
  const orgWide = new URL(req.url).searchParams.get("orgWide") === "1";
  return NextResponse.json(await getSegmentReport({ orgWide }));
}
