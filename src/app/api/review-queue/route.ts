import { NextResponse } from "next/server";
import { getReviewQueue } from "@/lib/db/review-queue";
import { getScope } from "@/lib/db/scope";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The needs-review queue (F1). Scope is enforced in the query layer:
 * supervisors see the org's open reviews, reps see rows on their own calls.
 *
 * `?count=1` returns just the open count — the sidebar badge's poll, kept as
 * cheap as possible because every signed-in member polls it once a minute.
 */
export async function GET(req: Request) {
  const scope = await getScope();
  if (!scope) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const rl = rateLimit(`review-queue:${scope.userId}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const page = await getReviewQueue(scope);
  const url = new URL(req.url);
  if (url.searchParams.get("count")) {
    return NextResponse.json(
      { count: page.rows.length, unavailable: page.unavailable },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
  return NextResponse.json(
    { rows: page.rows, count: page.rows.length, unavailable: page.unavailable },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
