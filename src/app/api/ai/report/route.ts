import { NextResponse } from "next/server";
import { getExecutiveReport } from "@/lib/ai/services";
import { getUser } from "@/lib/auth";
import { getReportingData } from "@/lib/db/metrics";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/** Executive narrative for the Reports page, computed from real account data. */
export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ data: null, source: "demo" });
  }
  const [{ metrics }, viewer] = await Promise.all([getReportingData(), getViewer()]);
  const isSolar = viewer.org ? viewer.org.dialerTemplate === "solar" : true;
  return NextResponse.json(await getExecutiveReport(metrics, isSolar));
}
