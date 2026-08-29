import { NextResponse } from "next/server";
import { getScope } from "@/lib/db/scope";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { count } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Client counter sink. `src/lib/telemetry.ts` is server-only, so events that
// HAPPEN in the browser (the dial round's phone-duplicate guard) need one
// narrow door into ops_metrics. Allowlisted by metric name — this endpoint
// must never become a way to spray arbitrary rows into the metrics table —
// and clamped, because a counter a client reports is a claim, not a fact.
// Demo mode (no auth) drops the report: count() would only console.log anyway.
// ─────────────────────────────────────────────────────────────────────────────

const CLIENT_METRICS = new Set(["lane.dup_dropped"]);

export async function POST(req: Request) {
  const limited = rateLimit(`telemetry:${clientIp(req)}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const scope = await getScope();
  if (!scope) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    metric?: string;
    value?: number;
  };
  const metric = typeof body.metric === "string" ? body.metric : "";
  if (!CLIENT_METRICS.has(metric)) {
    return NextResponse.json({ ok: false, error: "Unknown metric." }, { status: 400 });
  }
  const n = Number(body.value);
  const value = Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : 1;
  count(metric, value, { orgId: scope.orgId });
  return NextResponse.json({ ok: true });
}
