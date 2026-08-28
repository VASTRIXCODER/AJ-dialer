import { NextResponse } from "next/server";
import { orgAIContext } from "@/lib/ai/org-context";
import { getCallCopilot } from "@/lib/ai/services";
import { getLeadById } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  // AI spend needs a signed-in caller; the transcript field is caller-supplied
  // free text headed into a prompt, so anonymous access was also an injection
  // surface. RLS already stops cross-tenant lead reads.
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

  const { leadId, transcript } = (await req.json().catch(() => ({}))) as {
    leadId?: string;
    /** The live conversation so far ("role: message" lines), when one exists. */
    transcript?: string;
  };
  const lead = leadId ? await getLeadById(leadId) : null;
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const ctx = orgAIContext(viewer.org);
  return NextResponse.json(
    await getCallCopilot(
      lead,
      ctx.isSolar,
      typeof transcript === "string" && transcript.trim()
        ? transcript.slice(0, 8000)
        : undefined,
      ctx,
    ),
  );
}
