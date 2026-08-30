import { NextResponse } from "next/server";
import { getDialQueue, getMyLeadsCount } from "@/lib/db/leads";

export const dynamic = "force-dynamic";

/**
 * Returns the current dial queue for the signed-in viewer — their OWN uploaded
 * leads, filtered to dialable ones (leads are separated by uploader so reps never
 * dial each other's). Backs the "Load leads" button on the dialer. `total` is the
 * viewer's own lead count, so the UI can explain when leads exist but none are
 * dialable yet.
 *
 * `?assignment=<packId>` scopes the queue to one assignment. getDialQueue
 * verifies the pack really belongs to the caller (assigned to them, or they're
 * a supervisor) — an unverifiable id yields an EMPTY queue, never the full book.
 */
export async function GET(req: Request) {
  const assignment = new URL(req.url).searchParams.get("assignment") ?? undefined;
  try {
    const [leads, total] = await Promise.all([
      getDialQueue(assignment ? { assignmentId: assignment } : undefined),
      getMyLeadsCount(),
    ]);
    // `total` is null when the count could not be taken. It is passed through
    // as null rather than coerced, so the client says "we couldn't check"
    // instead of "you have 0 leads" to a rep holding a full book.
    return NextResponse.json({ leads, total });
  } catch (e) {
    // getDialQueue throws rather than returning [] when it cannot establish
    // scope or finish paging — an empty queue renders as "all done", which is
    // the most convincing possible lie about a book nobody has called.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't load the queue." },
      { status: 503 },
    );
  }
}
