import { NextResponse } from "next/server";
import { AI_MODEL, pingAI } from "@/lib/ai/claude";

export const dynamic = "force-dynamic";

/**
 * Anthropic connection health check. Visit /api/ai/health in a browser to
 * confirm the server can actually reach Claude:
 *   { configured: true, ok: true, model: "claude-opus-4-8", reply: "OK" }
 *
 *   configured:false → ANTHROPIC_API_KEY isn't set on the server (Vercel env).
 *   ok:false + error → key is set but the call failed (bad key, no model
 *                      access, network) — the `error` says which.
 */
export async function GET() {
  const result = await pingAI();
  return NextResponse.json(
    { expectedModel: AI_MODEL, ...result },
    { status: result.ok ? 200 : 503 },
  );
}
