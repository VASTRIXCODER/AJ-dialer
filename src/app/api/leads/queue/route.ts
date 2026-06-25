import { NextResponse } from "next/server";
import { getDialQueue, getMyLeadsCount } from "@/lib/db/leads";

export const dynamic = "force-dynamic";

/**
 * Returns the current dial queue for the signed-in viewer — their OWN uploaded
 * leads, filtered to dialable ones (leads are separated by uploader so reps never
 * dial each other's). Backs the "Load leads" button on the dialer. `total` is the
 * viewer's own lead count, so the UI can explain when leads exist but none are
 * dialable yet.
 */
export async function GET() {
  const [leads, total] = await Promise.all([getDialQueue(), getMyLeadsCount()]);
  return NextResponse.json({ leads, total });
}
