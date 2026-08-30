import { describe, expect, it, vi } from "vitest";
import {
  claimPinnedRound,
  orderedCandidateIds,
  pinnedLeadUnavailableMessage,
  reorderClaimed,
} from "@/lib/dialer/claims";

// ─────────────────────────────────────────────────────────────────────────────
// "I searched for a lead, pressed call, and it called a completely different
// person."
//
// The mechanism: picking a lead out of the dialer's queue browser only moved
// the CURSOR. Start then opened a 200-wide claim window at the cursor and let
// the server return the first ELIGIBLE lead in it — so a pick that was held by
// a teammate, cooling down, at its attempt cap, DNC'd, or outside its calling
// window was silently skipped and the NEXT candidate was dialed instead. The
// panel went on naming the lead the rep chose the whole time.
//
// claimPinnedRound is the fix: the pick is claimed ALONE first, so eligibility
// is decided about them and nobody else. Dialed, or refused out loud.
// ─────────────────────────────────────────────────────────────────────────────

type Row = { id: string; firstName: string; lastName: string; phone: string };

const lead = (id: string, firstName = id, lastName = "Doe"): Row => ({
  id,
  firstName,
  lastName,
  phone: `+1415555${id.padStart(4, "0")}`,
});

const QUEUE = [
  lead("a", "Aaron"),
  lead("b", "Bianca"),
  lead("c", "Carlos"),
  lead("d", "Dana"),
];

const describeRow = (l: Row) => `${l.firstName} ${l.lastName}`;

/**
 * A fake claim server. `eligible` is the set it will hand over; everything else
 * is "held / cooling down / capped" and simply doesn't come back — exactly how
 * the real RPC signals ineligibility (silently, by omission).
 */
function fakeServer(eligible: string[]) {
  const seen: { count: number; leadIds: string[] }[] = [];
  const claim = vi.fn(async ({ count, leadIds }: { count: number; leadIds: string[] }) => {
    seen.push({ count, leadIds });
    return leadIds
      .filter((id) => eligible.includes(id))
      .slice(0, count)
      .map((id) => QUEUE.find((l) => l.id === id)!);
  });
  return { claim, seen };
}

describe("claimPinnedRound — the picked lead is dialed, or nobody is", () => {
  it("REFUSES rather than dialing the next eligible person (the reported bug)", async () => {
    // Carlos is the pick and is NOT claimable. Dana, right behind him in the
    // window, is. The old path claimed the window and dialed Dana.
    const { claim } = fakeServer(["d", "a", "b"]);
    const outcome = await claimPinnedRound({
      pinned: lead("c", "Carlos"),
      candidates: orderedCandidateIds(QUEUE, 2, 200), // ["c","d","a","b"]
      parallel: 1,
      claim,
      describe: describeRow,
    });

    expect(outcome.status).toBe("refuse");
    if (outcome.status !== "refuse") return;
    expect(outcome.message).toContain("Carlos Doe");
    expect(outcome.message).toContain("Nobody else was dialed in their place");
    // The only thing it ever asked the server for was Carlos. Dana was never
    // claimed, so she can never end up on the wire.
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith({ count: 1, leadIds: ["c"] });
  });

  it("scopes the eligibility question to the pick alone — not the window", async () => {
    const { claim, seen } = fakeServer(["c"]);
    await claimPinnedRound({
      pinned: lead("c", "Carlos"),
      candidates: ["c", "d", "a", "b"],
      parallel: 1,
      claim,
      describe: describeRow,
    });
    // One line ⇒ one claim, for exactly one id. No window, nothing to substitute.
    expect(seen).toEqual([{ count: 1, leadIds: ["c"] }]);
  });

  it("dials the pick when it IS claimable", async () => {
    const { claim } = fakeServer(["a", "b", "c", "d"]);
    const outcome = await claimPinnedRound({
      pinned: lead("c", "Carlos"),
      candidates: ["c", "d", "a", "b"],
      parallel: 1,
      claim,
      describe: describeRow,
    });
    expect(outcome.status).toBe("dial");
    if (outcome.status !== "dial") return;
    expect(outcome.leads.map((l) => l.id)).toEqual(["c"]);
  });

  it("parallel dialing keeps the pick on lane 1 and fills the rest behind them", async () => {
    const { claim, seen } = fakeServer(["a", "b", "c", "d"]);
    const outcome = await claimPinnedRound({
      pinned: lead("c", "Carlos"),
      candidates: ["c", "d", "a", "b"],
      parallel: 3,
      claim,
      describe: describeRow,
    });
    expect(outcome.status).toBe("dial");
    if (outcome.status !== "dial") return;
    expect(outcome.leads[0].id).toBe("c");
    expect(outcome.leads).toHaveLength(3);
    // The pick is claimed on its own; the spare lanes never re-offer them.
    expect(seen[0]).toEqual({ count: 1, leadIds: ["c"] });
    expect(seen[1]).toEqual({ count: 2, leadIds: ["d", "a", "b"] });
    // …and the round still runs in the rep's order, pick first.
    expect(reorderClaimed(outcome.leads, outcome.candidates).map((l) => l.id)).toEqual([
      "c",
      "d",
      "a",
    ]);
  });

  it("an unclaimable pick refuses even when the spare lanes could have filled", async () => {
    // 3X dialing made this worse, not better: the round used to ring three
    // strangers while the rep watched their pick's name on screen.
    const { claim } = fakeServer(["a", "b", "d"]);
    const outcome = await claimPinnedRound({
      pinned: lead("c", "Carlos"),
      candidates: ["c", "d", "a", "b"],
      parallel: 3,
      claim,
      describe: describeRow,
    });
    expect(outcome.status).toBe("refuse");
    expect(claim).toHaveBeenCalledTimes(1); // no fill round is even attempted
  });

  it("hands back a hold it isn't going to dial (no leaked reservation)", async () => {
    // Defensive: the claim was scoped to one id, so another lead coming back is
    // a server bug — but an undialed hold locks that lead away from every rep
    // for the reservation TTL.
    const claim = vi.fn(async () => [lead("d", "Dana")]);
    const outcome = await claimPinnedRound({
      pinned: lead("c", "Carlos"),
      candidates: ["c", "d"],
      parallel: 1,
      claim,
      describe: describeRow,
    });
    expect(outcome.status).toBe("refuse");
    if (outcome.status !== "refuse") return;
    expect(outcome.release).toEqual(["d"]);
  });

  it("survives a dead claim endpoint by refusing, never by guessing", async () => {
    const claim = vi.fn(async () => []); // what postClaim returns on a network error
    const outcome = await claimPinnedRound({
      pinned: lead("c", "Carlos"),
      candidates: ["c", "d", "a", "b"],
      parallel: 3,
      claim,
      describe: describeRow,
    });
    expect(outcome.status).toBe("refuse");
  });

  it("a one-lead queue has no spare lanes to claim", async () => {
    const { claim, seen } = fakeServer(["c"]);
    const outcome = await claimPinnedRound({
      pinned: lead("c", "Carlos"),
      candidates: ["c"],
      parallel: 3,
      claim,
      describe: describeRow,
    });
    expect(outcome.status).toBe("dial");
    expect(seen).toHaveLength(1);
  });

  it("names an unnamed pick by their number instead of saying “Unknown”", async () => {
    const { claim } = fakeServer([]);
    const outcome = await claimPinnedRound({
      pinned: { id: "c", firstName: "", lastName: "", phone: "+14155550143" },
      candidates: ["c"],
      parallel: 1,
      claim,
      // Mirrors the engine's leadDisplayName(name, phone) call.
      describe: (l) => (`${l.firstName} ${l.lastName}`.trim() ? "x" : "(415) 555-0143"),
    });
    expect(outcome.status).toBe("refuse");
    if (outcome.status !== "refuse") return;
    expect(outcome.message).toContain("(415) 555-0143");
  });
});

describe("pinnedLeadUnavailableMessage — an honest refusal", () => {
  it("names the person, the likely reasons, and promises nobody else was called", () => {
    const msg = pinnedLeadUnavailableMessage("Carlos Doe");
    expect(msg).toContain("Carlos Doe");
    expect(msg).toContain("held by another rep");
    expect(msg).toContain("Do-Not-Call");
    expect(msg).toContain("Nobody else was dialed in their place");
  });
});
