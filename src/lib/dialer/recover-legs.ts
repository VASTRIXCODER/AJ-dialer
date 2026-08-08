import "server-only";

import { getRestClient } from "@/lib/twilio";
import { toE164 } from "@/lib/utils";

/**
 * Find the outbound legs a dial attempt just placed, from the dialed numbers
 * alone.
 *
 * `/api/twilio/call` puts real phones on the wire and THEN returns the leg SIDs
 * in its response body. Those two facts travel separately: the calls are already
 * ringing the moment Twilio accepts them, while the SIDs have to survive a trip
 * back through the CDN to the rep's browser. When that trip fails — a dropped
 * body, a WAF hiccup, a rate limit (the same class of failure that used to eat
 * Twilio's own callbacks, see getPublicBaseUrl) — the browser is left believing
 * nothing was dialed, when in fact a homeowner's phone is ringing an empty room.
 *
 * Twilio has no such ambiguity, so ask Twilio. Given the numbers we tried to
 * dial, this returns the legs for them that are still live, which is enough to
 * either finish joining the call or hang it up.
 *
 * Deliberately narrow: only calls created inside `windowMs` and only ones that
 * haven't ended. A signed-in user can therefore act on the leg their own dial
 * just created, not on arbitrary history for that number.
 */

const LIVE = new Set(["queued", "initiated", "ringing", "in-progress"]);

/** How far back a leg can have been created and still count as "this attempt". */
export const RECOVERY_WINDOW_MS = 120_000;

export interface DialTarget {
  leadId: string;
  phone: string;
}

export interface RecoveredLeg {
  leadId: string;
  sid: string;
  status: string;
}

/** Normalize + de-duplicate what the client claims it dialed. */
export function parseDialTargets(value: unknown): DialTarget[] {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: DialTarget[] = [];
  for (const row of rows.slice(0, 10)) {
    if (!row || typeof row !== "object") continue;
    const { leadId, phone } = row as { leadId?: unknown; phone?: unknown };
    const to = toE164(String(phone ?? ""));
    const id = String(leadId ?? "").trim();
    if (!to || !id || seen.has(to)) continue;
    seen.add(to);
    out.push({ leadId: id, phone: to });
  }
  return out;
}

export async function findRecentLegs(
  targets: DialTarget[],
  windowMs: number = RECOVERY_WINDOW_MS,
): Promise<RecoveredLeg[]> {
  if (!targets.length) return [];
  const client = await getRestClient();
  if (!client) return [];

  const cutoff = Date.now() - windowMs;
  // Twilio's StartTime filter is coarse (and a queued leg has no start time at
  // all), so ask for a generous slice and do the real windowing here on
  // dateCreated, which every call has from the instant it is accepted.
  const startTimeAfter = new Date(cutoff - 86_400_000);

  const found = await Promise.all(
    targets.map(async ({ leadId, phone }) => {
      try {
        const calls = await client.calls.list({
          to: phone,
          startTimeAfter,
          limit: 20,
        });
        const leg = calls.find(
          (c) =>
            LIVE.has(String(c.status)) &&
            (c.dateCreated ? c.dateCreated.getTime() >= cutoff : false),
        );
        return leg ? { leadId, sid: leg.sid, status: String(leg.status) } : null;
      } catch {
        // One unreachable number must not cost us the others.
        return null;
      }
    }),
  );

  return found.filter((l): l is RecoveredLeg => Boolean(l));
}
