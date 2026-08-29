import { NextResponse } from "next/server";
import { claimCallback } from "@/lib/db/callbacks";
import { getScope } from "@/lib/db/scope";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST — claim a callback before dialing it (the board's "Call back" flow).
 *
 * `{ ok: true }`  — the claim is yours; go dial.
 * `{ ok: false }` — someone else holds a LIVE claim (`claimedBy` names them
 *                   when known). HTTP 200 on purpose: losing the race is a
 *                   normal outcome, not an error.
 *
 * The claim itself is the atomic app_claim_callback RPC (unclaimed OR mine OR
 * stale > 15 min), so two simultaneous clicks get exactly one true.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid callback id." }, { status: 400 });
  }
  const scope = await getScope();
  if (!scope) {
    return NextResponse.json({ ok: false, error: "You must be signed in." }, { status: 401 });
  }
  const r = await claimCallback(id, scope.userId);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error ?? "Claim failed." }, { status: 400 });
  }
  return NextResponse.json({ ok: r.claimed, claimedBy: r.claimedByName ?? "" });
}
