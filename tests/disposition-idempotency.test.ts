import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistDisposition,
  replayQueuedDispositions,
  type DispositionPayload,
} from "@/lib/dialer/disposition-queue";

// The duplicate-disposition bug: a POST that succeeded server-side but whose
// response was lost got replayed by the outbox as a brand-new insert — a
// duplicate call record AND a duplicate appointment. The fix is client-side
// half: the idempotency key is stamped BEFORE the first POST and the queued
// payload carries the SAME key on every replay (the server's unique index does
// the rest).

function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

const posted: DispositionPayload[] = [];
let failNext = false;

beforeEach(() => {
  posted.length = 0;
  failNext = false;
  vi.stubGlobal("window", { localStorage: makeStorage() });
  vi.stubGlobal("fetch", async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as DispositionPayload;
    posted.push(body);
    if (failNext) throw new Error("network down");
    return { ok: true } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persistDisposition idempotency key", () => {
  it("stamps a clientAttemptId before the first POST", async () => {
    await persistDisposition({ leadId: "l1", outcome: "no_answer" });
    expect(posted).toHaveLength(1);
    expect(typeof posted[0].clientAttemptId).toBe("string");
    expect(String(posted[0].clientAttemptId).length).toBeGreaterThan(8);
  });

  it("never overwrites a caller-provided key", async () => {
    await persistDisposition({ leadId: "l1", outcome: "no_answer", clientAttemptId: "fixed-key" });
    expect(posted[0].clientAttemptId).toBe("fixed-key");
  });

  it("replays a failed save with the SAME key", async () => {
    failNext = true;
    await persistDisposition({ leadId: "l1", outcome: "appointment_booked" });
    const firstKey = posted[0].clientAttemptId;
    expect(firstKey).toBeTruthy();

    failNext = false;
    await replayQueuedDispositions();
    expect(posted).toHaveLength(2);
    expect(posted[1].clientAttemptId).toBe(firstKey);
  });

  it("drains the outbox after a successful replay (no third POST)", async () => {
    failNext = true;
    await persistDisposition({ leadId: "l1", outcome: "callback_scheduled" });
    failNext = false;
    await replayQueuedDispositions();
    await replayQueuedDispositions();
    expect(posted).toHaveLength(2);
  });

  it("mints DISTINCT keys for distinct dispositions", async () => {
    await persistDisposition({ leadId: "l1", outcome: "no_answer" });
    await persistDisposition({ leadId: "l2", outcome: "no_answer" });
    expect(posted[0].clientAttemptId).not.toBe(posted[1].clientAttemptId);
  });
});
