import { describe, expect, it } from "vitest";
import {
  claimEmptyMessage,
  computeReleaseSet,
  mergeClaimedLeads,
} from "@/lib/dialer/claims";
import type { Lead } from "@/lib/types";

// Claim bookkeeping for the reservation dialer: merging claim responses into
// the display queue, and which holds a teardown releases client-side.

function lead(id: string): Lead {
  return {
    id,
    firstName: `L${id}`,
    lastName: "",
    phone: `+1512555${id.padStart(4, "0")}`,
    address: "",
    city: "",
    state: "",
    zip: "",
    utilityProvider: "",
    solarProvider: "",
    status: "new",
    campaignId: "",
    hasEV: false,
    hasPool: false,
    hasBattery: false,
    multipleSystems: false,
    createdAt: "2026-01-01T00:00:00Z",
    timezone: "",
  };
}

describe("mergeClaimedLeads", () => {
  it("appends claimed leads the queue doesn't hold, preserving queue order", () => {
    const queue = [lead("1"), lead("2")];
    const merged = mergeClaimedLeads(queue, [lead("3"), lead("4")]);
    expect(merged.map((l) => l.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("dedupes against the queue AND within the claim batch itself", () => {
    const queue = [lead("1")];
    const merged = mergeClaimedLeads(queue, [lead("1"), lead("2"), lead("2")]);
    expect(merged.map((l) => l.id)).toEqual(["1", "2"]);
  });

  it("returns the SAME array when nothing changes (no phantom re-render)", () => {
    const queue = [lead("1"), lead("2")];
    expect(mergeClaimedLeads(queue, [lead("1")])).toBe(queue);
    expect(mergeClaimedLeads(queue, [])).toBe(queue);
  });

  it("drops claims with no id rather than corrupting the queue", () => {
    const queue = [lead("1")];
    const bad = { ...lead("2"), id: "" };
    expect(mergeClaimedLeads(queue, [bad])).toBe(queue);
  });
});

describe("computeReleaseSet", () => {
  it("releases every held lead on skip and reset", () => {
    expect(computeReleaseSet("skip", ["a", "b"])).toEqual(["a", "b"]);
    expect(computeReleaseSet("reset", new Set(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("releases NOTHING on disposition — the server clears the hold", () => {
    expect(computeReleaseSet("disposition", ["a", "b"])).toEqual([]);
  });

  it("dedupes and drops blanks", () => {
    expect(computeReleaseSet("skip", ["a", "", "a", "b"])).toEqual(["a", "b"]);
  });
});

describe("claimEmptyMessage", () => {
  it("says claimed/cooling-down (with the queue size) when leads exist", () => {
    const msg = claimEmptyMessage(37);
    expect(msg).toContain("claimed or cooling down");
    expect(msg).toContain("37 in queue");
  });

  it("points at Load leads when nothing is loaded at all", () => {
    expect(claimEmptyMessage(0)).toContain("Load leads");
  });
});
