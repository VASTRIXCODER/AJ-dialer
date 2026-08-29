import { NextResponse } from "next/server";
import { countFilteredLeads } from "@/lib/db/leads-filter";
import { getScope } from "@/lib/db/scope";
import { sanitizeFilterSpec } from "@/lib/leads/filter-spec";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Live match count for the filter builder: `{ filter } → { count }`.
 *
 * The spec is UNTRUSTED JSON and is sanitized HERE, server-side, before it goes
 * anywhere near the SQL compiler — the client's own sanitization is a courtesy,
 * not a boundary. A spec with no valid conditions left is a 400 rather than a
 * count of everything: "matches all N leads" for a filter the server actually
 * dropped would be an accurate-looking lie.
 *
 * Demo mode (no Supabase) skips getScope() — there is no session to read and
 * the count runs over the bundled sample book — but still rate-limits by IP.
 */
export async function POST(req: Request) {
  const scope = isSupabaseConfigured() ? await getScope() : null;
  if (isSupabaseConfigured() && !scope) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const rl = rateLimit(`filter-count:${scope?.userId ?? clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many count requests — give it a second." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { filter?: unknown };
  const spec = sanitizeFilterSpec(body.filter);
  if (!spec) {
    return NextResponse.json(
      { error: "That filter has no valid conditions." },
      { status: 400 },
    );
  }

  const count = await countFilteredLeads(
    scope ?? { userId: "demo", orgId: null, supervisor: true },
    spec,
  );
  return NextResponse.json({ count });
}
