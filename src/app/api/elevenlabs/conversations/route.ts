import { NextResponse } from "next/server";
import { listActiveAICalls, listRecentAICalls } from "@/lib/ai-call-store";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

/** Feeds the Live Monitor + AI Agent page with active and recent AI calls. */
export async function GET() {
  return NextResponse.json({
    configured: isElevenLabsConfigured(),
    active: listActiveAICalls(),
    recent: listRecentAICalls(),
  });
}
