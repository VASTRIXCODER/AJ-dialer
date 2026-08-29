import "server-only";

import { isAdminConfigured } from "@/lib/supabase/admin";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { count } from "@/lib/telemetry";
import {
  type FloorEnvelope,
  type FloorEvent,
  type FloorEventPayloadMap,
  orgFloorTopic,
  stampEnvelope,
} from "./events";

// ─────────────────────────────────────────────────────────────────────────────
// Server → floor publisher. Stateless on purpose: webhooks and store writes run
// on short-lived serverless instances, so holding a Realtime WEBSOCKET open per
// instance would mean a connect/join handshake on every publish. Supabase
// Realtime exposes exactly the escape hatch this wants — a plain HTTP broadcast
// endpoint (`POST {SUPABASE_URL}/realtime/v1/api/broadcast`, the same one
// supabase-js's channel.send() uses when the socket isn't joined) — and the
// service-role key bypasses the channel RLS, making the server the ONLY party
// able to publish (clients' insert policy allows presence only).
//
// Fire-and-forget, always: this is called from Twilio/ElevenLabs webhook paths
// and DB write choke points, and a realtime hiccup must never fail a webhook or
// delay a disposition. Failures become count("realtime.publish_fail") and the
// consumers' slow-poll fallback picks up the slack.
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Give a hung broadcast POST this long, then abandon it. */
const PUBLISH_TIMEOUT_MS = 1_500;

// Monotonic per-instance sequence — a tie-breaker/staleness hint for consumers,
// not a total order (serverless publishes from many instances at once).
let seq = 0;

/**
 * Broadcast one event onto the org's private floor channel. Never throws,
 * never blocks the caller: kick off the POST and return immediately.
 *
 * No-ops (silently) without an orgId — rows that predate org scoping have
 * nowhere to publish to — or without the service role (demo mode), where every
 * consumer is already on its poll fallback.
 */
export function publishOrgEvent<E extends FloorEvent>(
  orgId: string | null | undefined,
  event: E,
  payload: Omit<FloorEventPayloadMap[E], keyof FloorEnvelope>,
): void {
  if (!orgId || !isAdminConfigured()) return;
  try {
    const body = JSON.stringify({
      messages: [
        {
          topic: orgFloorTopic(orgId),
          event,
          payload: stampEnvelope<E>(payload, ++seq),
          private: true,
        },
      ],
    });
    void fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body,
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    }).then(
      (res) => {
        if (!res.ok) {
          count("realtime.publish_fail", 1, { orgId, event, status: res.status });
        }
      },
      () => count("realtime.publish_fail", 1, { orgId, event, status: 0 }),
    );
  } catch {
    // Even building the request must never reach a webhook path.
    count("realtime.publish_fail", 1, { orgId, event, status: -1 });
  }
}
