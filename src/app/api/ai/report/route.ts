import { NextResponse } from "next/server";
import { getExecutiveReport } from "@/lib/ai/services";
import { metrics } from "@/lib/data";

export async function POST() {
  return NextResponse.json(await getExecutiveReport(metrics));
}
