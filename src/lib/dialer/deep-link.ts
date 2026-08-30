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

// ─────────────────────────────────────────────────────────────────────────────
// …and which channel is going to place it.
//
// A ?dial= link is an instruction about WHO to call, so the dialer honors it in
// whichever channel the workspace actually allows. Getting this wrong is not a
// cosmetic bug: the auto-dial used to bail out silently whenever the dialer was
// in AI mode — the BOOT mode on every AI-configured workspace — leaving the rep
// under a "Dialing now…" banner that was describing nothing. Their natural next
// move, pressing Start, opened a session on whoever the loaded queue happened
// to be parked on, and a completely different person answered.
//
// Pure, and shared by the effect that dials and the banner that narrates it, so
// the two cannot disagree about what is happening.
// ─────────────────────────────────────────────────────────────────────────────

export type DeepLinkChannel = "manual" | "ai" | "none";

export function deepLinkChannel(config: {
  /** `features.manualDialer` — a workspace may be AI-only. */
  manualEnabled: boolean;
  /** An ElevenLabs agent is actually wired up. */
  aiAgentConfigured: boolean;
  /** AI is permitted for THIS viewer (plan + role). */
  aiEnabled: boolean;
}): DeepLinkChannel {
  // Manual wins when it's available, even in a workspace that boots into AI:
  // the rep is at the keyboard, having just pressed Call on a specific person.
  if (config.manualEnabled) return "manual";
  if (config.aiAgentConfigured && config.aiEnabled) return "ai";
  // AI-only workspace, no usable agent. Nothing is going to dial, and the
  // banner has to say so rather than promise a hand-off that never happens.
  return "none";
}
