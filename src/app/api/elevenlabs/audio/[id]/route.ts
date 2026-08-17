import { getAICall } from "@/lib/ai-call-store";
import { getAIConversation } from "@/lib/db/records";
import { getConversationAudio, isElevenLabsConfigured } from "@/lib/elevenlabs";
import { viewerCanAny, viewerOrgId } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/** Proxies a conversation recording so the Monitor can play it without the key. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Same org-ownership gate as /api/elevenlabs/conversation/[id]: the ElevenLabs
  // account is shared across every org, so without this a supervisor in org A
  // could stream org B's call audio just by knowing its conversationId. Trust the
  // in-memory store's recorded org when the call is resident here; otherwise fall
  // back to the RLS-scoped DB read, which hides other orgs' conversations.
  if (!(await viewerCanAny(["monitor.view", "reports.view"]))) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!isElevenLabsConfigured()) {
    return new Response("ElevenLabs not configured", { status: 503 });
  }
  const { id } = await params;
  const orgId = await viewerOrgId();
  if (!orgId) return new Response("Forbidden", { status: 403 });
  const store = getAICall(id);
  if (store) {
    if (store.orgId !== orgId) return new Response("Forbidden", { status: 403 });
  } else if (!(await getAIConversation(id))) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const res = await getConversationAudio(id);
    return new Response(res.body, {
      headers: {
        "content-type": res.headers.get("content-type") ?? "audio/mpeg",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Recording unavailable", { status: 502 });
  }
}
