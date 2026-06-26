import { mergeSettings } from "@/lib/org/settings";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Twilio's classic hold music — the fallback when an org hasn't set its own.
const DEFAULT_HOLD =
  "http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3";

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Only ever emit well-formed public http(s) media URLs into the TwiML. */
function isPlayableUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Conference wait/hold music. Set as the `waitUrl` on the homeowner's conference
 * leg, so while they wait alone (or are placed on hold) they hear the org's own
 * playlist instead of Twilio's default tone. Twilio re-requests this when the
 * playlist finishes, so the list loops. `?org=<id>` selects whose playlist to
 * play; this endpoint is hit by Twilio (no session), so it resolves the org via
 * the service-role client.
 */
export async function GET(req: Request) {
  const orgId = new URL(req.url).searchParams.get("org");
  let urls: string[] = [];
  if (orgId && isAdminConfigured()) {
    try {
      const { data } = await createAdminClient()
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .maybeSingle();
      const settings = mergeSettings(data?.settings);
      urls = (settings.dialing.holdMusicUrls ?? []).filter(isPlayableUrl);
    } catch {
      /* fall through to default */
    }
  }
  const playlist = urls.length ? urls : [DEFAULT_HOLD];
  const body = playlist.map((u) => `<Play>${escapeXml(u)}</Play>`).join("");
  return twiml(body);
}

// Twilio may issue the waitUrl request as POST depending on configuration.
export const POST = GET;
