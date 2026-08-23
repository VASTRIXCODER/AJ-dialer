import { getAICall } from "@/lib/ai-call-store";
import { mediaResponse, rangeHeaders } from "@/lib/audio-proxy";
import { getAIConversation } from "@/lib/db/records";
import { getConversationAudio, isElevenLabsConfigured } from "@/lib/elevenlabs";
import { viewerCanAny, viewerOrgId } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/** Proxies a conversation recording so the Monitor can play it without the key. */
export async function GET(
  req: Request,
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
    // Forward the browser's Range so <audio> can seek. Without it the element
    // gets an unseekable stream and a supervisor can only listen from 0:00.
    const res = await getConversationAudio(id, rangeHeaders(req));
    if (!res.ok || !res.body) {
      return new Response("Recording unavailable", { status: 502 });
    }
    return mediaResponse(res);
  } catch {
    return new Response("Recording unavailable", { status: 502 });
  }
}
