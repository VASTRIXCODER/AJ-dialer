import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Live presence for human (manual Twilio) calls so they show up in the Live
// Monitor alongside AI calls. Human calls run in the rep's browser via the
// Twilio Device, so there's nothing to poll server-side — the client registers
// start / connect / end here. Module-level state with a TTL sweep so a call can
// never linger forever if the browser closes mid-call.
//
// Single-instance state (correct for `next start`); on horizontally-scaled
// serverless, back this with Redis/Twilio Sync for cross-instance visibility.
// ─────────────────────────────────────────────────────────────────────────────

export interface HumanCall {
  id: string;
  leadName: string;
  city: string;
  phone: string;
  state: "ringing" | "connected";
  startedAt: number;
}

const calls = new Map<string, HumanCall>();
const TTL_MS = 30 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [id, c] of calls) {
    if (now - c.startedAt > TTL_MS) calls.delete(id);
  }
}

export function startHumanCall(input: {
  id: string;
  leadName: string;
  city?: string;
  phone?: string;
}): void {
  sweep();
  calls.set(input.id, {
    id: input.id,
    leadName: input.leadName || "Manual call",
    city: input.city ?? "",
    phone: input.phone ?? "",
    state: "ringing",
    startedAt: Date.now(),
  });
}

export function connectHumanCall(id: string): void {
  const c = calls.get(id);
  if (c) c.state = "connected";
}

export function endHumanCall(id: string): void {
  calls.delete(id);
}

export function listActiveHumanCalls(): HumanCall[] {
  sweep();
  return [...calls.values()].sort((a, b) => b.startedAt - a.startedAt);
}
