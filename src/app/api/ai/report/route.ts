import { NextResponse } from "next/server";
import { getExecutiveReport } from "@/lib/ai/services";
import { getUser } from "@/lib/auth";
import { getReportingData } from "@/lib/db/metrics";

export const dynamic = "force-dynamic";

/** Executive narrative for the Reports page, computed from real account data. */
export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ data: null, source: "demo" });
  }
  const { metrics } = await getReportingData();
  return NextResponse.json(await getExecutiveReport(metrics));
}
