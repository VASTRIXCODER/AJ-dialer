import { NextResponse } from "next/server";
import { getScope } from "@/lib/db/scope";
import { createSmartList, listSmartLists } from "@/lib/db/smart-lists";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { count } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

/**
 * Smart lists — GET the viewer's lists, POST a new one.
 *
 * GET deliberately returns NO per-list live counts: each count is a full
 * filter scan, and a chips row of N lists would fire N scans on every page
 * load. A caller that wants a count for ONE list runs its filter through
 * /api/leads/filter/count like any other spec.
 *
 * POST: `{ name, description?, filter, shared? } → { list }`. The filter is
 * untrusted JSON sanitized in the db layer. Any member may save a PRIVATE
 * list; publishing a shared list to the whole org needs the leads.import
 * permission (the same bar as curating the shared book).
 */
export async function GET(req: Request) {
  const scope = isSupabaseConfigured() ? await getScope() : null;
  if (isSupabaseConfigured() && !scope) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const rl = rateLimit(`smart-lists:${scope?.userId ?? clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests — give it a second." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  const lists = await listSmartLists(
    scope ?? { userId: "demo", orgId: null, supervisor: true },
  );
  return NextResponse.json({ lists });
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Connect Supabase to save lists." },
      { status: 400 },
    );
  }
  const scope = await getScope();
  if (!scope) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const rl = rateLimit(`smart-lists-write:${scope.userId}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests — give it a second." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    tone?: string;
    filter?: unknown;
    shared?: boolean;
    favorite?: boolean;
  };

  const shared = body.shared !== false;
  if (shared) {
    const viewer = await getViewer();
    if (!viewer.permissions.includes("leads.import")) {
      return NextResponse.json(
        { error: "You don't have permission to create shared lists — save it as private instead." },
        { status: 403 },
      );
    }
  }

  const result = await createSmartList(scope, {
    name: body.name ?? "",
    description: body.description,
    tone: body.tone,
    filter: body.filter,
    shared,
    favorite: body.favorite,
  });
  if (result.error || !result.list) {
    return NextResponse.json({ error: result.error ?? "Couldn't save that list." }, { status: 400 });
  }
  count("smart_lists.create", 1, { orgId: scope.orgId, shared });
  return NextResponse.json({ list: result.list });
}
