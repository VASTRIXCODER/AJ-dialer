import { NextResponse } from "next/server";
import { getScope } from "@/lib/db/scope";
import { deleteSmartList, updateSmartList } from "@/lib/db/smart-lists";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { count } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One smart list: PATCH name/description/tone/filter/favorite/shared, DELETE.
 *
 * The WHO-may rules live in the db layer (owner or manager+ for shared rows;
 * seeded rows can't be deleted by reps). The one route-level addition: turning
 * a private list INTO a shared one is publishing to the whole org, so it takes
 * the same leads.import permission POST requires for shared creation.
 */
async function auth(id: string) {
  if (!isSupabaseConfigured()) {
    return { error: "Connect Supabase to manage lists.", status: 400 as const };
  }
  const scope = await getScope();
  if (!scope) return { error: "Sign in first.", status: 401 as const };
  const rl = rateLimit(`smart-lists-write:${scope.userId}`, 30, 60_000);
  if (!rl.ok) {
    return { error: "Too many requests — give it a second.", status: 429 as const };
  }
  if (!UUID.test(id)) return { error: "Unknown list.", status: 404 as const };
  return { scope };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await auth(id);
  if ("error" in res) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    tone?: string;
    filter?: unknown;
    favorite?: boolean;
    shared?: boolean;
  };

  if (body.shared === true) {
    const viewer = await getViewer();
    if (!viewer.permissions.includes("leads.import")) {
      return NextResponse.json(
        { error: "You don't have permission to share lists with the whole workspace." },
        { status: 403 },
      );
    }
  }

  const result = await updateSmartList(res.scope, id, {
    name: body.name,
    description: body.description,
    tone: body.tone,
    filter: body.filter,
    favorite: body.favorite,
    shared: body.shared,
  });
  if (result.error || !result.list) {
    const denied = result.error?.startsWith("You can't");
    return NextResponse.json(
      { error: result.error ?? "Couldn't update that list." },
      { status: denied ? 403 : 400 },
    );
  }
  count("smart_lists.update", 1, { orgId: res.scope.orgId });
  return NextResponse.json({ list: result.list });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await auth(id);
  if ("error" in res) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }
  const result = await deleteSmartList(res.scope, id);
  if (!result.ok) {
    const denied =
      result.error?.startsWith("You can't") || result.error?.startsWith("Only managers");
    return NextResponse.json(
      { error: result.error ?? "Couldn't delete that list." },
      { status: denied ? 403 : 400 },
    );
  }
  count("smart_lists.delete", 1, { orgId: res.scope.orgId });
  return NextResponse.json({ ok: true });
}
