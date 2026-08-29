import { describe, expect, it } from "vitest";
import {
  decideMuteToggle,
  resolveMuteCapability,
} from "@/lib/dialer/mute-intent";

// Pre-answer mute: the pure intent-queue decision. The rep leg joins the
// conference when device.connect() resolves — before the customer answers —
// so a mute press is APPLIED when a Call exists, QUEUED during the sub-second
// arming window, and IGNORED when nothing is in flight at all.

describe("decideMuteToggle", () => {
  it("applies to a live call, toggling the muted state", () => {
    expect(decideMuteToggle({ muted: false, hasCall: true, dialInFlight: false })).toEqual({
      action: "apply",
      muted: true,
    });
    expect(decideMuteToggle({ muted: true, hasCall: true, dialInFlight: false })).toEqual({
      action: "apply",
      muted: false,
    });
  });

  it("queues the intent during the arming window (dial in flight, no Call yet)", () => {
    expect(decideMuteToggle({ muted: false, hasCall: false, dialInFlight: true })).toEqual({
      action: "queue",
      muted: true,
    });
    // Toggling twice in the window queues the LATEST intent — back to unmuted.
    expect(decideMuteToggle({ muted: true, hasCall: false, dialInFlight: true })).toEqual({
      action: "queue",
      muted: false,
    });
  });

  it("prefers the live call over the in-flight flag when both are true", () => {
    // connect() resolved while the flag hadn't been cleared yet — the Call is
    // always the real target once it exists.
    expect(decideMuteToggle({ muted: false, hasCall: true, dialInFlight: true })).toEqual({
      action: "apply",
      muted: true,
    });
  });

  it("ignores a press when nothing is in flight — no optimistic muted pill", () => {
    expect(decideMuteToggle({ muted: false, hasCall: false, dialInFlight: false })).toEqual({
      action: "ignore",
    });
    expect(decideMuteToggle({ muted: true, hasCall: false, dialInFlight: false })).toEqual({
      action: "ignore",
    });
  });
});

describe("resolveMuteCapability", () => {
  it("is unsupported in AI mode regardless of everything else", () => {
    expect(
      resolveMuteCapability({ twilioLive: true, aiMode: true, hasCall: true, dialInFlight: true }),
    ).toBe("unsupported");
  });

  it("is unsupported without a live Twilio device (demo / offline)", () => {
    expect(
      resolveMuteCapability({ twilioLive: false, aiMode: false, hasCall: false, dialInFlight: true }),
    ).toBe("unsupported");
  });

  it("is ready the moment a Call exists (pre-answer included)", () => {
    expect(
      resolveMuteCapability({ twilioLive: true, aiMode: false, hasCall: true, dialInFlight: false }),
    ).toBe("ready");
  });

  it("is arming between Start and connect() resolving", () => {
    expect(
      resolveMuteCapability({ twilioLive: true, aiMode: false, hasCall: false, dialInFlight: true }),
    ).toBe("arming");
  });

  it("is unsupported when idle — there is nothing to mute", () => {
    expect(
      resolveMuteCapability({ twilioLive: true, aiMode: false, hasCall: false, dialInFlight: false }),
    ).toBe("unsupported");
  });
});
