import { NextResponse } from "next/server";
import {
  getArchivedCall,
  searchCallArchive,
  type ArchiveChannel,
  type ArchiveMedia,
} from "@/lib/db/call-archive";

export const dynamic = "force-dynamic";

const CHANNELS = new Set<ArchiveChannel>(["all", "ai", "human"]);
const MEDIA = new Set<ArchiveMedia>(["all", "recording", "transcript"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The call archive: search + filter across every recording and transcript the
 * viewer may see. Scope is enforced in the query layer (supervisors org-wide,
 * reps their own), so there is nothing to gate here beyond shaping the params.
 *
 * `?id=<call>` returns ONE call with its full transcript — the detail read,
 * deliberately separate so a page of results never ships every transcript.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  const id = url.searchParams.get("id");
  if (id) {
    const call = await getArchivedCall(id);
    if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ call });
  }

  const one = (key: string) => url.searchParams.get(key) ?? undefined;
  const channel = one("channel");
  const media = one("media");
  const from = one("from");
  const to = one("to");

  const page = await searchCallArchive({
    q: one("q"),
    channel: CHANNELS.has(channel as ArchiveChannel)
      ? (channel as ArchiveChannel)
      : "all",
    outcome: one("outcome"),
    repId: one("rep"),
    // A malformed date must not become a filter — an unparseable bound would
    // silently return an empty archive and look like "you have no calls".
    from: from && ISO_DATE.test(from) ? from : undefined,
    to: to && ISO_DATE.test(to) ? to : undefined,
    media: MEDIA.has(media as ArchiveMedia) ? (media as ArchiveMedia) : "all",
    offset: Number(one("offset") ?? "0"),
    limit: Number(one("limit") ?? "25"),
  });

  return NextResponse.json(page);
}
