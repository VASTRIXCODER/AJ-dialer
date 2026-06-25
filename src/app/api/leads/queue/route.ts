import { NextResponse } from "next/server";
import { getDialQueue, getLeads } from "@/lib/db/leads";

export const dynamic = "force-dynamic";

/**
 * Returns the current dial queue for the signed-in viewer (the shared org pool,
 * filtered to dialable leads). Backs the "Load leads" button on the dialer so a
 * rep can pull leads into the Power Dialer on demand. `total` is every visible
 * lead, so the UI can explain when leads exist but none are dialable yet.
 */
export async function GET() {
  const [leads, all] = await Promise.all([getDialQueue(), getLeads()]);
  return NextResponse.json({ leads, total: all.length });
}
