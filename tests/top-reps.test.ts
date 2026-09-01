import { describe, expect, it } from "vitest";
import { rankTopReps, type RankableBooking } from "@/lib/org/top-reps";
import { can, effectivePermissions } from "@/lib/permissions";

const reps = [
  { userId: "u-ana", name: "Ana" },
  { userId: "u-ben", name: "Ben" },
  { userId: "u-cara", name: "Cara" },
  { userId: "u-dev", name: "Dev" },
];

/** n bookings for a rep, each one hour apart starting at `startMs`. */
function bookings(ownerId: string, n: number, startMs = 1_000): RankableBooking[] {
  return Array.from({ length: n }, (_, i) => ({ ownerId, at: startMs + i * 3_600_000 }));
}

describe("rankTopReps", () => {
  it("takes the top N by appointments booked", () => {
    const top = rankTopReps(
      [...bookings("u-ana", 5), ...bookings("u-ben", 9), ...bookings("u-cara", 7)],
      reps,
      3,
    );
    expect(top.map((t) => t.userId)).toEqual(["u-ben", "u-cara", "u-ana"]);
    expect(top.map((t) => t.rank)).toEqual([1, 2, 3]);
    expect(top[0].appointments).toBe(9);
  });

  it("excludes anyone outside the ranked candidate list", () => {
    // A manager's bookings must not displace a rep — managers already have AI
    // access and are filtered out before ranking.
    const top = rankTopReps(
      [...bookings("u-manager", 50), ...bookings("u-ana", 2)],
      reps,
      3,
    );
    expect(top.map((t) => t.userId)).toEqual(["u-ana"]);
  });

  it("never includes a rep with zero bookings", () => {
    // Only two reps produced, so only two get access — "top 3" must not hand
    // access to someone who booked nothing just to fill the slot.
    const top = rankTopReps([...bookings("u-ana", 1), ...bookings("u-ben", 2)], reps, 3);
    expect(top).toHaveLength(2);
    expect(top.map((t) => t.userId)).toEqual(["u-ben", "u-ana"]);
  });

  it("breaks ties toward whoever got there first, deterministically", () => {
    // Both booked 3; Ana's most recent is older, so she reached 3 earlier.
    const top = rankTopReps(
      [...bookings("u-ben", 3, 500_000), ...bookings("u-ana", 3, 1_000)],
      reps,
      1,
    );
    expect(top.map((t) => t.userId)).toEqual(["u-ana"]);
  });

  it("is stable across repeated evaluation, so access can't flap", () => {
    const rows = [...bookings("u-ana", 4), ...bookings("u-ben", 4), ...bookings("u-cara", 4)];
    const a = rankTopReps(rows, reps, 2);
    const b = rankTopReps([...rows].reverse(), reps, 2);
    expect(a.map((t) => t.userId)).toEqual(b.map((t) => t.userId));
  });

  it("returns nothing when the rule is off or there are no candidates", () => {
    expect(rankTopReps(bookings("u-ana", 5), reps, 0)).toEqual([]);
    expect(rankTopReps(bookings("u-ana", 5), [], 3)).toEqual([]);
  });

  it("handles more slots than producing reps", () => {
    const top = rankTopReps(bookings("u-ana", 3), reps, 10);
    expect(top).toHaveLength(1);
    expect(top[0].rank).toBe(1);
  });
});

describe("how the grant composes with stored overrides", () => {
  // getViewer folds the auto-grant in UNDER the member's stored overrides:
  //   effectivePermissions(role, { ...autoGrants, ...membership.permissions })
  const compose = (auto: Record<string, boolean>, stored: Record<string, boolean>) => ({
    ...auto,
    ...stored,
  });

  it("gives a top rep the AI dialer they don't get from their role", () => {
    expect(can("rep", "dialer.ai", {})).toBe(false);
    expect(can("rep", "dialer.ai", compose({ "dialer.ai": true }, {}))).toBe(true);
  });

  it("lets an admin's explicit REVOKE beat the automatic grant", () => {
    // Someone in the top 3 whom an admin has explicitly switched off stays off.
    const merged = compose({ "dialer.ai": true }, { "dialer.ai": false });
    expect(can("rep", "dialer.ai", merged)).toBe(false);
  });

  it("keeps an admin's explicit GRANT when the rep drops out of the top N", () => {
    const merged = compose({}, { "dialer.ai": true });
    expect(can("rep", "dialer.ai", merged)).toBe(true);
  });

  it("takes AI access away again once a rep leaves the top N", () => {
    expect(can("rep", "dialer.ai", compose({}, {}))).toBe(false);
  });

  it("changes nothing else about what a rep can do", () => {
    const before = effectivePermissions("rep", {});
    const after = effectivePermissions("rep", compose({ "dialer.ai": true }, {}));
    expect(after.filter((p) => p !== "dialer.ai")).toEqual(before);
  });

  it("leaves managers unaffected — they already have it by role", () => {
    expect(can("manager", "dialer.ai", {})).toBe(true);
  });
});

describe("whole-org AI access (ai.allRepAccess)", () => {
  // getViewer resolves the grant the same way for either rule, so the only
  // thing that differs is which reps land in `autoGrants`.
  const resolve = (opts: {
    allRepAccess?: boolean;
    topRepUserIds?: string[];
    userId: string;
    stored?: Record<string, boolean>;
  }) => {
    const auto: Record<string, boolean> = opts.allRepAccess
      ? { "dialer.ai": true }
      : (opts.topRepUserIds ?? []).includes(opts.userId)
        ? { "dialer.ai": true }
        : {};
    return can("rep", "dialer.ai", { ...auto, ...(opts.stored ?? {}) });
  };

  it("gives every rep the AI dialer, not just the ranked ones", () => {
    expect(resolve({ allRepAccess: true, userId: "u-nobody" })).toBe(true);
    expect(resolve({ allRepAccess: true, userId: "u-anyone-else" })).toBe(true);
  });

  it("supersedes the top-N rule rather than competing with it", () => {
    // Off the leaderboard entirely, but the floor-wide switch is on.
    expect(
      resolve({ allRepAccess: true, topRepUserIds: ["u-ana"], userId: "u-zed" }),
    ).toBe(true);
  });

  it("still lets an admin switch one rep off", () => {
    expect(
      resolve({ allRepAccess: true, userId: "u-ana", stored: { "dialer.ai": false } }),
    ).toBe(false);
  });

  it("takes access away from everyone again when switched off", () => {
    expect(resolve({ allRepAccess: false, userId: "u-ana" })).toBe(false);
  });
});
