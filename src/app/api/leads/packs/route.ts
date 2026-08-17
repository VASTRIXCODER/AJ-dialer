import { NextResponse } from "next/server";
import { assignPack, listAssignablePacks } from "@/lib/db/lead-pack-assign";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/** Managers+ only. The db layer re-checks the role independently — this gate is
 *  for a clean 403 and to keep the UI honest, not the security boundary. */
async function guard() {
  const viewer = await getViewer();
  return viewer.permissions.includes("leads.import");
}

/** The org's packs, with who holds each one and how far through it they are. */
export async function GET() {
  if (!(await guard())) {
    return NextResponse.json(
      { packs: [], error: "You don't have permission to view lead packs." },
      { status: 403 },
    );
  }
  return NextResponse.json({ packs: await listAssignablePacks() });
}

/** Hand a pack to a rep, or send `repId: null` to take it back. */
export async function POST(req: Request) {
  if (!(await guard())) {
    return NextResponse.json(
      { ok: false, error: "Only admins and managers can assign lead packs." },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    packId?: string;
    repId?: string | null;
  };
  const result = await assignPack(
    String(body.packId ?? ""),
    body.repId ? String(body.repId) : null,
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
