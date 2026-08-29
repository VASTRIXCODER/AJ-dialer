import { NextResponse } from "next/server";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Hand claimed work back to the shared queue.
 *
 * Scoped to the caller's OWN holds by construction (`reserved_by = userId`), so
 * there is no way to spell a request that releases someone else's work — a rep
 * cannot pull a teammate's queue out from under them mid-call. Releasing is
 * always available and never destructive: the item returns to `pending` exactly
 * as it was, which is what makes claiming safe to try.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!viewer.permissions.includes("work.claim")) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }
  const scope = await getScope();
  if (!scope?.orgId || !isAdminConfigured()) {
    return NextResponse.json({ error: "Workspace unavailable." }, { status: 400 });
  }
  const rl = rateLimit(`crm-release:${scope.userId}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 50).map(String) : null;

  try {
    const admin = createAdminClient();
    let q = admin
      .from("work_items")
      .update({
        status: "pending",
        reserved_by: null,
        reserved_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", scope.orgId)
      .eq("reserved_by", scope.userId)
      .eq("status", "reserved");
    if (ids?.length) q = q.in("id", ids);
    const { data, error } = await q.select("id");
    if (error) {
      return NextResponse.json({ error: "Couldn't release right now." }, { status: 500 });
    }
    return NextResponse.json({ released: (data ?? []).length });
  } catch {
    return NextResponse.json({ error: "Couldn't release right now." }, { status: 500 });
  }
}
