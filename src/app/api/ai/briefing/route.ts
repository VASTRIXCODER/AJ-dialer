import { NextResponse } from "next/server";
import { orgAIContext } from "@/lib/ai/org-context";
import { getLeadBriefing } from "@/lib/ai/services";
import { getLeadById } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  // AI spend needs a signed-in caller (demo mode has no key and simulates).
  // RLS already stops cross-tenant lead reads; this stops anonymous token burn.
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const rl = rateLimit(`ai:${viewer.user?.id ?? "demo"}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { leadId } = (await req.json().catch(() => ({}))) as { leadId?: string };
  const lead = leadId ? await getLeadById(leadId) : null;
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const ctx = orgAIContext(viewer.org);
  return NextResponse.json(await getLeadBriefing(lead, ctx.isSolar, ctx));
}
