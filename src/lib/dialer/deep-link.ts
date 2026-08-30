// ─────────────────────────────────────────────────────────────────────────────
// The dialer deep link — one builder, so every "call this person" entry point
// agrees on the contract the dialer page actually parses:
//
//   dial=<phone>      sanitised to digits/+ server-side
//   name=<name>       percent-encoded ONCE (Next.js decodes it once; decoding
//                     again throws URIError on a literal "%" in a lead name)
//   callback=<uuid>   what CLOSES the promise when the disposition is filed —
//                     omit it and the callback stays open forever
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dialDeepLink(input: {
  phone: string;
  name?: string | null;
  /** Only a real uuid rides along — the dialer drops anything else anyway. */
  callbackId?: string | null;
}): string {
  const phone = (input.phone ?? "").trim();
  if (!phone) return "/dialer";
  const params = new URLSearchParams({ dial: phone });
  const name = (input.name ?? "").trim();
  if (name) params.set("name", name.slice(0, 80));
  if (input.callbackId && UUID.test(input.callbackId)) {
    params.set("callback", input.callbackId);
  }
  return `/dialer?${params.toString()}`;
}
