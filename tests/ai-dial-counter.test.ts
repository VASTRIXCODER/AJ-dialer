import { describe, expect, it } from "vitest";
import { isStaleDialKey } from "@/lib/use-dialer";

const TODAY = "2026-09-02";

describe("isStaleDialKey", () => {
  it("keeps today's counters — both the total and the AI-only one", () => {
    // The bug this guards: pruning the current day would reset a rep's
    // counters on every mount, silently.
    expect(isStaleDialKey(`aj:dials:u1:${TODAY}`, TODAY)).toBe(false);
    expect(isStaleDialKey(`aj:aiDials:u1:${TODAY}`, TODAY)).toBe(false);
  });

  it("prunes BOTH prefixes from previous days", () => {
    expect(isStaleDialKey("aj:dials:u1:2026-09-01", TODAY)).toBe(true);
    expect(isStaleDialKey("aj:aiDials:u1:2026-09-01", TODAY)).toBe(true);
  });

  it("keeps another rep's counters for the same day", () => {
    expect(isStaleDialKey(`aj:dials:u2:${TODAY}`, TODAY)).toBe(false);
    expect(isStaleDialKey(`aj:aiDials:u2:${TODAY}`, TODAY)).toBe(false);
  });

  it("never touches unrelated storage", () => {
    // The dialer shares localStorage with caller-ID exclusions, power mode,
    // local presence and the disposition outbox — none may be swept.
    for (const k of [
      "aj:excludedCallerIds:u1",
      "aj:localPresence:u1",
      "aj:powerMode:u1",
      "aj:myLeadsOnly:u1",
      "dialer.pendingDispositions.v1",
      "theme",
    ]) {
      expect(isStaleDialKey(k, TODAY)).toBe(false);
    }
  });

  it("handles the anonymous (demo, signed-out) key shape", () => {
    expect(isStaleDialKey(`aj:aiDials:anon:${TODAY}`, TODAY)).toBe(false);
    expect(isStaleDialKey("aj:aiDials:anon:2020-01-01", TODAY)).toBe(true);
  });
});
