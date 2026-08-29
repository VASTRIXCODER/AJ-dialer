import { NextResponse } from "next/server";
import { setLeadsArchived } from "@/lib/db/lead-archive";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { count } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

/**
 * Bulk archive / unarchive: `{ leadIds, unarchive? } → { updated }`.
 *
 * Same request shape as /api/leads/delete, but gated MANAGER+ up front (the
 * supervisor split delete resolves per row): archiving curates the SHARED org
 * book — rows vanish from everyone's default view — so it belongs to the people
 * responsible for that book, and a rep tidying their own upload still has
 * delete for that. setLeadsArchived re-checks the same role server-side, so
 * neither layer is load-bearing alone.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.user && !viewer.isDemo) {
    return NextResponse.json(
      { updated: 0, error: "You must be signed in to archive leads." },
      { status: 401 },
    );
  }
  // Demo mode: nothing to archive — same graceful refusal as delete.
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { updated: 0, error: "Connect Supabase to manage leads." },
      { status: 400 },
    );
  }

  const scope = await getScope();
  if (!scope) {
    return NextResponse.json(
      { updated: 0, error: "You must be signed in to archive leads." },
      { status: 401 },
    );
  }
  if (!scope.supervisor) {
    return NextResponse.json(
      { updated: 0, error: "Only managers and above can archive leads." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    leadIds?: string[];
    unarchive?: boolean;
  };
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ updated: 0, error: "No leads selected." }, { status: 400 });
  }
  const unarchive = body.unarchive === true;

  const result = await setLeadsArchived(body.leadIds.slice(0, 10000), !unarchive);
  if (!result.error && result.updated > 0) {
    count("leads.bulk_archive", result.updated, { orgId: scope.orgId, unarchive });
  }
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
