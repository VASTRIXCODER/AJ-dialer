import { NextResponse } from "next/server";
import { getExecutiveReport } from "@/lib/ai/services";
import { getReportingData } from "@/lib/db/metrics";

export const dynamic = "force-dynamic";

/** Executive narrative for the Reports page, computed from real account data. */
export async function POST() {
  const { metrics } = await getReportingData();
  return NextResponse.json(await getExecutiveReport(metrics));
}
