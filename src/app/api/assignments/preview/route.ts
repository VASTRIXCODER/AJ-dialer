import { NextResponse } from "next/server";
import {
  previewSourceAllocation,
  type AllocationSource,
} from "@/lib/db/assignments";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Live "of N eligible" for the Allocate wizard. Resolves the source exactly
 * the way the commit will (same candidate-id chain), so the preview and the
 * allocation can never disagree about what's in play.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("assignments.manage")) {
    return NextResponse.json(
      { error: "You don't have permission to allocate assignments." },
      { status: 403 },
    );
  }
  const scope = (await getScope()) ?? {
    userId: "demo",
    orgId: null,
    supervisor: true,
  };
  const body = (await req.json().catch(() => ({}))) as {
    source?: AllocationSource;
    count?: number;
  };
  const source: AllocationSource =
    body.source && typeof body.source === "object" ? body.source : { kind: "pool" };
  if (!["pool", "filter", "smart_list"].includes(String(source.kind))) {
    return NextResponse.json({ error: "Unknown allocation source." }, { status: 400 });
  }
  const { preview, error } = await previewSourceAllocation(
    scope,
    source,
    Number(body.count ?? 0),
  );
  return NextResponse.json(error ? { preview, error } : { preview });
}
