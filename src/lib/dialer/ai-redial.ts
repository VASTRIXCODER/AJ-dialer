// Pure rules for re-dialing an AI call. Client-safe.
//
// The manual dialer has always had Redial; the AI side had nothing, so a call
// that rang out or died on connect was lost unless the whole list ran again.
// The rules are small but each one exists because getting it wrong dials a real
// person twice.

/** The shape a re-dialable row needs — a subset of AiLaunch. */
export interface RedialCandidate {
  leadId: string;
  conversationId?: string | null;
}

/**
 * Ad-hoc numbers dialed from the pad carry a synthetic `manual-<ts>` id and no
 * lead record, so there is nothing to look up and nothing to dial again.
 */
export function isAdHoc(leadId: string): boolean {
  return leadId.startsWith("manual-");
}

/** A row may be re-dialed once its call is off the wire and it has a real lead. */
export function canRedial(call: RedialCandidate, isLive: boolean): boolean {
  return !isLive && !isAdHoc(call.leadId);
}

/**
 * The targets for a bulk "Dial again (N)".
 *
 * `calls` is newest-first and one lead can hold several rows (first attempt, the
 * double-tap, an earlier manual re-dial). Keeping every row would place one call
 * per ROW — three calls at one homeowner who simply has three rows. Only the
 * newest row per lead survives.
 */
export function redialTargets<T extends RedialCandidate>(
  calls: readonly T[],
  isLive: (call: T) => boolean,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of calls) {
    // Claim the lead on the FIRST row seen for it, before deciding whether that
    // row qualifies. Skipping straight past a live row instead would leave the
    // lead unclaimed, and an older finished row for the same lead would then
    // qualify — placing a second call on someone already talking to the agent.
    if (seen.has(c.leadId)) continue;
    seen.add(c.leadId);
    if (canRedial(c, isLive(c))) out.push(c);
  }
  return out;
}

/**
 * Is this lead already on the wire?
 *
 * The engine reserves a line as `lead:<id>` while dialing and holds `redial:<id>`
 * across the double-tap gap. A press that ignored either would put two live
 * calls on one homeowner — the single worst outcome this button can produce, so
 * it is checked before anything else happens.
 */
export function aiDialInFlight(
  leadId: string,
  inflight: ReadonlySet<string>,
  pendingRedials: ReadonlySet<string>,
): boolean {
  return (
    inflight.has(`lead:${leadId}`) ||
    inflight.has(`redial:${leadId}`) ||
    pendingRedials.has(leadId)
  );
}
