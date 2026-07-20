import { NextResponse } from "next/server";
import { getBookedLeads } from "@/lib/db/leads";

export const dynamic = "force-dynamic";

/**
 * Leads that already have an appointment booked, in the same scope as
 * /api/leads/queue. Backs the Power Dialer's "Booked" tab — these are exactly
 * the leads the dial queue skips on every reload.
 */
export async function GET() {
  const leads = await getBookedLeads();
  return NextResponse.json({ leads });
}
