import { NextResponse } from "next/server";
import { getAnswered } from "@/lib/call-registry";

export const dynamic = "force-dynamic";

/**
 * Polled by the browser during parallel dialing to learn which homeowner
 * answered first (the winning leg). Returns `{ answeredLeadId: null }` until a
 * leg connects.
 */
export async function GET(req: Request) {
  const room = new URL(req.url).searchParams.get("room");
  if (!room) {
    return NextResponse.json({ error: "room required" }, { status: 400 });
  }
  return NextResponse.json({ answeredLeadId: getAnswered(room) });
}
