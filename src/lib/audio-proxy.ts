import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Shared plumbing for the two call-recording proxies (Twilio and ElevenLabs).
//
// Both used to hand the browser an opaque stream with no length and no range
// support, which is why recordings could only ever be played from the beginning:
// with no `Accept-Ranges` and no `Content-Length`, an <audio> element can't seek
// and often can't even draw a scrub bar. A supervisor checking "what did they
// say at 4:20?" had to sit through four minutes of the call.
//
// Fixing it is entirely a matter of forwarding the request's Range header
// upstream and passing the upstream's range headers (and 206 status) back.
// ─────────────────────────────────────────────────────────────────────────────

/** The request headers a media proxy must forward upstream. */
export function rangeHeaders(req: Request): Record<string, string> {
  const range = req.headers.get("range");
  return range ? { Range: range } : {};
}

/**
 * Wrap an upstream media response for the browser: same body, same status
 * (206 for a partial), and the headers a media element needs to seek.
 *
 * Deliberately does NOT copy the upstream's cache headers — the audio is
 * private to the workspace, so the caching policy is ours to state.
 */
export function mediaResponse(upstream: Response): Response {
  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
    "cache-control": "private, max-age=3600",
    // Announced even when the upstream didn't, so the browser knows it may ask.
    // A range request the upstream ignores simply returns the whole body — the
    // element still works, it just can't seek to an unbuffered point.
    "accept-ranges": upstream.headers.get("accept-ranges") ?? "bytes",
  });
  for (const key of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
