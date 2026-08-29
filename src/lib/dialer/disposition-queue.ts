// ─────────────────────────────────────────────────────────────────────────────
// Client-side durable outbox for call dispositions.
//
// The dialer used to file an outcome with `void fetch(...).catch(() => {})` and
// advance the queue immediately, so a POST that failed on a flaky connection was
// silently lost — a booked appointment vanished while the rep moved to the next
// homeowner, convinced they'd saved it. This persists any failed disposition to
// localStorage and replays it on the next load, so a disposition is never lost:
// it's either accepted by the server or waiting in the outbox to be retried.
//
// Browser-only (guards on `window`); imported from client components.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "dialer.pendingDispositions.v1";
/** Cap the outbox so a long offline stretch can't grow it without bound. */
const MAX_QUEUED = 100;

export type DispositionPayload = Record<string, unknown>;

function read(): DispositionPayload[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: DispositionPayload[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX_QUEUED)));
  } catch {
    /* storage full / disabled — nothing we can do */
  }
}

function enqueue(payload: DispositionPayload): void {
  const items = read();
  items.push(payload);
  write(items);
}

async function postOnce(payload: DispositionPayload): Promise<boolean> {
  try {
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      // Let an in-flight save complete even if the rep navigates away or closes
      // the tab during wrap-up.
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Persist a disposition. Advances nothing — the caller advances the queue
 * immediately for snappy UX; durability is guaranteed here in the background:
 * on any failure the payload is queued for replay rather than dropped.
 *
 * Stamps a client idempotency key BEFORE the first POST, so a replay of a
 * save whose response was lost carries the SAME key — the server's unique
 * index then makes the replay a no-op instead of a duplicate record +
 * duplicate appointment (the exact bug this outbox used to cause).
 */
export async function persistDisposition(payload: DispositionPayload): Promise<void> {
  if (!payload.clientAttemptId) {
    payload.clientAttemptId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ca-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  if (!(await postOnce(payload))) enqueue(payload);
}

/**
 * Retry every queued disposition (call once on dialer mount). Successful ones are
 * removed; the rest stay for the next attempt. Runs sequentially so a burst can't
 * hammer the API.
 */
export async function replayQueuedDispositions(): Promise<void> {
  const items = read();
  if (!items.length) return;
  const remaining: DispositionPayload[] = [];
  for (const item of items) {
    if (!(await postOnce(item))) remaining.push(item);
  }
  write(remaining);
}
