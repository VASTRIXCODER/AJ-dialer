import { getUser } from "@/lib/auth";
import { getConversationAudio, isElevenLabsConfigured } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

/** Proxies a conversation recording so the Monitor can play it without the key. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!isElevenLabsConfigured()) {
    return new Response("ElevenLabs not configured", { status: 503 });
  }
  const { id } = await params;
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
