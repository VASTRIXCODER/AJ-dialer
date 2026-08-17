import { NextResponse } from "next/server";
import {
  MAX_PACK_SIZE,
  countAvailable,
  createLeadPack,
  listLeadPacks,
  type PackSource,
} from "@/lib/db/lead-packs";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/** Managers+ only. The db layer re-checks the role independently — this gate is
 *  for a clean 403 and to keep the UI honest, not the security boundary. */
async function guard() {
  const viewer = await getViewer();
  return viewer.permissions.includes("leads.import");
}

/** List the org's packs with live progress. */
export async function GET() {
  if (!(await guard())) {
    return NextResponse.json(
      { packs: [], error: "You don't have permission to view lead packs." },
      { status: 403 },
    );
  }
  return NextResponse.json({ packs: await listLeadPacks() });
}

/**
 * POST — create a pack, or (with `preview: true`) just report how many leads the
 * filter currently matches, so the dialog can show "312 available" before
 * anyone commits to handing leads over.
 */
export async function POST(req: Request) {
  if (!(await guard())) {
    return NextResponse.json(
      { ok: false, error: "Only admins and managers can assign lead packs." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    repId?: string;
    size?: number;
    source?: PackSource;
    preview?: boolean;
  };
  const source: PackSource = {
    leadGroup: body.source?.leadGroup ?? null,
    campaignId: body.source?.campaignId ?? null,
    onlyUnassigned: body.source?.onlyUnassigned !== false,
  };

  if (body.preview) {
    return NextResponse.json({ available: await countAvailable(source) });
  }

  const result = await createLeadPack({
    name: String(body.name ?? ""),
    repId: String(body.repId ?? ""),
    size: Math.min(Number(body.size) || 0, MAX_PACK_SIZE),
    source,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
