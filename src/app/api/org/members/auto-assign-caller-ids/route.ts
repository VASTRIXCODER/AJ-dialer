import { NextResponse } from "next/server";
import { autoAssignCallerIds } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * One-click "deal the org's caller-ID pool out to its reps" — see
 * planAutoAssignCallerIds (lib/dialer/rotation.ts) for the actual round-robin
 * and autoAssignCallerIds (lib/org/membership.ts) for the permission gate
 * (members.role) and the org/rep scoping. Org-scoped, not per-member, so it
 * has no request body — the caller's active org and its active reps are all
 * this needs.
 */
export async function POST() {
  const r = await autoAssignCallerIds();
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
