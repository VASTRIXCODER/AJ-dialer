import { describe, expect, it, vi } from "vitest";
import {
  describeDialFailure,
  isTransientProviderError,
  placeLegWithRetry,
} from "@/lib/dialer/place-call";

/** The exact error a rep saw: Twilio's SDK wording for a 502. */
const twilio502 = Object.assign(new Error("[HTTP 502] Failed to execute request"), {
  status: 502,
});
const twilio400 = Object.assign(new Error("[HTTP 400] The 'From' number is not valid"), {
  status: 400,
});

const noSleep = async () => {};

describe("isTransientProviderError", () => {
  it("treats 5xx and 429 as retryable", () => {
    expect(isTransientProviderError(twilio502)).toBe(true);
    expect(isTransientProviderError({ status: 503 })).toBe(true);
    expect(isTransientProviderError({ status: 429 })).toBe(true);
  });

  it("treats a real rejection as permanent", () => {
    // Retrying an unverified number or a bad caller ID just delays an error
    // somebody has to act on.
    expect(isTransientProviderError(twilio400)).toBe(false);
    expect(isTransientProviderError({ status: 401 })).toBe(false);
    expect(isTransientProviderError({ status: 21210 })).toBe(false);
  });

  it("recognises network failures with no status at all", () => {
    expect(isTransientProviderError(new Error("socket hang up"))).toBe(true);
    expect(isTransientProviderError(new Error("ECONNRESET"))).toBe(true);
    expect(isTransientProviderError(new Error("[HTTP 502] Failed to execute request"))).toBe(true);
    expect(isTransientProviderError(new Error("Something else broke"))).toBe(false);
  });
});

describe("describeDialFailure", () => {
  it("replaces opaque transient wording with something actionable", () => {
    const msg = describeDialFailure(twilio502);
    expect(msg).not.toContain("Failed to execute request");
    expect(msg).toContain("was not placed");
  });

  it("keeps Twilio's own wording for a real rejection", () => {
    // This is the message the team needs in order to fix the account.
    expect(describeDialFailure(twilio400)).toContain("'From' number is not valid");
  });
});

describe("placeLegWithRetry", () => {
  it("returns the sid on a clean first attempt", async () => {
    const createCall = vi.fn().mockResolvedValue({ sid: "CA1" });
    const findExisting = vi.fn();
    const r = await placeLegWithRetry({ createCall, findExisting, sleep: noSleep });
    expect(r).toMatchObject({ sid: "CA1", error: null, attempts: 1, adopted: false });
    expect(findExisting).not.toHaveBeenCalled();
  });

  it("recovers a dial that a transient 502 would have thrown away", async () => {
    const createCall = vi
      .fn()
      .mockRejectedValueOnce(twilio502)
      .mockResolvedValueOnce({ sid: "CA2" });
    const findExisting = vi.fn().mockResolvedValue(null); // nothing was placed
    const r = await placeLegWithRetry({ createCall, findExisting, sleep: noSleep });
    expect(r.sid).toBe("CA2");
    expect(r.attempts).toBe(2);
    expect(createCall).toHaveBeenCalledTimes(2);
  });

  it("NEVER double-dials when the 502 masked a successful create", async () => {
    // The dangerous case: Twilio processed the call and lost the response.
    // A second create would ring the homeowner twice.
    const createCall = vi.fn().mockRejectedValue(twilio502);
    const findExisting = vi.fn().mockResolvedValue({ sid: "CA-already-ringing" });
    const r = await placeLegWithRetry({ createCall, findExisting, sleep: noSleep });
    expect(r).toMatchObject({ sid: "CA-already-ringing", adopted: true, error: null });
    expect(createCall).toHaveBeenCalledTimes(1); // the redial that didn't happen
  });

  it("does not retry a permanent rejection", async () => {
    const createCall = vi.fn().mockRejectedValue(twilio400);
    const findExisting = vi.fn();
    const r = await placeLegWithRetry({ createCall, findExisting, sleep: noSleep });
    expect(createCall).toHaveBeenCalledTimes(1);
    expect(findExisting).not.toHaveBeenCalled();
    expect(r.error).toContain("'From' number is not valid");
  });

  it("stops rather than risk a duplicate when the safety check itself fails", async () => {
    // We can't prove a retry is safe, so we don't retry. A failed dial is
    // recoverable; a homeowner rung twice is not.
    const createCall = vi.fn().mockRejectedValue(twilio502);
    const findExisting = vi.fn().mockRejectedValue(new Error("lookup down"));
    const r = await placeLegWithRetry({ createCall, findExisting, sleep: noSleep });
    expect(createCall).toHaveBeenCalledTimes(1);
    expect(r.sid).toBeNull();
  });

  it("makes exactly one attempt when no duplicate guard is supplied", async () => {
    const createCall = vi.fn().mockRejectedValue(twilio502);
    const r = await placeLegWithRetry({ createCall, sleep: noSleep });
    expect(createCall).toHaveBeenCalledTimes(1);
    expect(r.attempts).toBe(1);
  });

  it("gives up after the configured attempts and reports the failure", async () => {
    const createCall = vi.fn().mockRejectedValue(twilio502);
    const findExisting = vi.fn().mockResolvedValue(null);
    const r = await placeLegWithRetry({
      createCall,
      findExisting,
      delaysMs: [1, 1],
      sleep: noSleep,
    });
    expect(createCall).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(r.sid).toBeNull();
    expect(r.attempts).toBe(3);
    expect(r.error).toContain("was not placed");
  });
});
