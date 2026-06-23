import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Live presence for human (manual Twilio) calls so supervisors can see — and
// listen to — a rep's in-progress call in the Live Monitor. Human calls run in
// the rep's browser via the Twilio Device, so the client registers start /
// connect / end here; the TwiML voice route attaches the agent-leg CallSid so we
// can fork its audio to the relay without disturbing the call.
//
// Scoped by owner (the rep) + org so the monitor only ever shows an org's own
// calls. Single-instance state (correct for `next start`); back with Redis /
// Twilio Sync for horizontal scale.
// ─────────────────────────────────────────────────────────────────────────────

export interface HumanCall {
  id: string;
  leadName: string;
  city: string;
  phone: string;
  state: "ringing" | "connected";
  startedAt: number;
  ownerId: string | null;
  orgId: string | null;
  repName: string;
  /** Agent-leg Twilio CallSid (set by the voice route once the call is placed). */
  callSid: string | null;
  /** Active media-stream SID while a supervisor is listening. */
  streamSid?: string;
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
  ownerId?: string | null;
  orgId?: string | null;
  repName?: string;
}): void {
  sweep();
  const existing = calls.get(input.id);
  calls.set(input.id, {
    id: input.id,
    leadName: input.leadName || "Manual call",
    city: input.city ?? "",
    phone: input.phone ?? "",
    state: "ringing",
    startedAt: Date.now(),
    ownerId: input.ownerId ?? null,
    orgId: input.orgId ?? null,
    repName: input.repName ?? "",
    callSid: existing?.callSid ?? null, // a CallSid attached pre-start survives
  });
}

export function connectHumanCall(id: string): void {
  const c = calls.get(id);
  if (c) c.state = "connected";
}

export function endHumanCall(id: string): void {
  calls.delete(id);
}

/** Attach the agent-leg CallSid (called from the TwiML voice route). */
export function attachHumanCallSid(id: string, callSid: string): void {
  sweep();
  const c = calls.get(id);
  if (c) {
    c.callSid = callSid;
  } else {
    // The voice webhook can arrive a beat before the client's "start" — stash a
    // placeholder so the SID isn't lost; start() preserves it.
    calls.set(id, {
      id,
      leadName: "Manual call",
      city: "",
      phone: "",
      state: "ringing",
      startedAt: Date.now(),
      ownerId: null,
      orgId: null,
      repName: "",
      callSid,
    });
  }
}

export function setHumanStreamSid(id: string, streamSid: string | undefined): void {
  const c = calls.get(id);
  if (c) c.streamSid = streamSid;
}

export function getHumanCall(id: string): HumanCall | null {
  return calls.get(id) ?? null;
}

export function listActiveHumanCalls(): HumanCall[] {
  sweep();
  return [...calls.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** Active human calls within an org (the supervisor's monitor view). */
export function listActiveHumanCallsForOrg(orgId: string | null): HumanCall[] {
  sweep();
  return [...calls.values()]
    .filter((c) => orgId != null && c.orgId === orgId)
    .sort((a, b) => b.startedAt - a.startedAt);
}
