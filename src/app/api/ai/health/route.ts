import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { AI_MODEL, pingAI } from "@/lib/ai/claude";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Anthropic connection health check. Visit /api/ai/health in a browser to
 * confirm the server can actually reach Claude:
 *   { configured: true, ok: true, model: "claude-opus-5", reply: "OK",
 *     stopReason: "end_turn", latencyMs: 812 }
 *
 *   configured:false → ANTHROPIC_API_KEY isn't set on the server (Vercel env).
 *   ok:false + error → key is set but the call failed (bad key, no model
 *                      access, network) — the `error` says which, in words an
 *                      operator can act on rather than a raw SDK message.
 *   degraded:[…]     → the configured model rejected an advanced parameter
 *                      (thinking / effort / structured outputs) and the AI layer
 *                      has stopped sending it. Everything still works; the model
 *                      is simply older or served by a provider that lacks it.
 */
export async function GET() {
  // Require a signed-in user when Supabase is configured: this pings Claude (real
  // token spend) and returns the model name + raw provider error strings.
  if (isSupabaseConfigured() && !(await getUser())) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const result = await pingAI();
  return NextResponse.json(
    { expectedModel: AI_MODEL, ...result },
    { status: result.ok ? 200 : 503 },
  );
}
