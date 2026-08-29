import { describe, expect, it } from "vitest";
import {
  compareRanked,
  composeLeaderboard,
  type LeaderboardMember,
} from "@/lib/leaderboard";
import { zonedMonthRange } from "@/lib/metrics/compute";
import { DEFAULT_LEADERBOARD, mergeLeaderboardSettings, type LeaderboardSettings } from "@/lib/org/settings";

const TZ = "America/Chicago";

// Fri 2026-08-28, 13:00 CDT (18:00Z) — an ordinary, DST-free anchor.
const NOW = Date.parse("2026-08-28T18:00:00Z");

const MEMBERS: LeaderboardMember[] = [
  { userId: "u-alice", name: "Alice Adams", role: "rep" },
  { userId: "u-bob", name: "Bob Brown", role: "rep" },
];

type Row = Record<string, unknown>;

/** A call row on the org-local day of `iso`. */
const call = (
  owner: string,
  iso: string,
  outcome: string | null,
  talkSec?: number,
  channel: "human" | "ai" = "human",
): Row => ({
  owner_id: owner,
  outcome,
  // talk unknown when talkSec is undefined (legacy row) — the gate must not fire.
  ...(talkSec === undefined ? {} : { talk_sec: talkSec }),
  duration_sec: talkSec,
  channel,
  started_at: iso,
});

const cfg = (over: Partial<LeaderboardSettings> = {}): LeaderboardSettings =>
  mergeLeaderboardSettings({ ...DEFAULT_LEADERBOARD, ...over });

const daily = { period: "daily" as const, tz: TZ, now: NOW };

describe("points math + breakdown", () => {
  it("scores each component at the configured rate and the breakdown sums exactly to the total", () => {
    const rows = [
      call("u-alice", "2026-08-28T15:00:00Z", "qualified", 60), // connect + qualified + 1 talk min
      call("u-alice", "2026-08-28T15:10:00Z", "appointment_booked", 60), // connect + appt + 1 talk min
      call("u-alice", "2026-08-28T15:20:00Z", "no_answer", 0), // nothing
    ];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), {
      ...daily,
      appointments: [{ owner_id: "u-alice", status: "completed", created_at: "2026-08-28T16:00:00Z" }],
      callbacks: [{ owner_id: "u-alice", status: "completed", last_attempt_at: "2026-08-28T16:30:00Z" }],
    });
    const alice = board.entries.find((e) => e.id === "u-alice")!;
    // 2×1 (connects) + 3 (qualified) + 5 (booked) + 8 (kept) + 2 (callback) + 2×0.1 (talk)
    expect(alice.stat.points).toBe(20.2);
    const sum = alice.stat.breakdown.reduce((n, b) => n + b.points, 0);
    expect(Math.round(sum * 100) / 100).toBe(alice.stat.points);
    // Every listed count matches the tally it claims.
    expect(alice.stat.breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: "humanConnect", count: 2, points: 2 }),
        expect.objectContaining({ component: "qualified", count: 1, points: 3 }),
        expect.objectContaining({ component: "appointmentBooked", count: 1, points: 5 }),
        expect.objectContaining({ component: "appointmentKept", count: 1, points: 8 }),
        expect.objectContaining({ component: "callbackCompleted", count: 1, points: 2 }),
        expect.objectContaining({ component: "talkMinute", count: 2, points: 0.2 }),
      ]),
    );
  });

  it("honors custom point values", () => {
    const rows = [call("u-alice", "2026-08-28T15:00:00Z", "qualified", 120)];
    const board = composeLeaderboard(
      rows,
      MEMBERS,
      cfg({ points: { ...DEFAULT_LEADERBOARD.points, humanConnect: 10, qualified: 0, talkMinute: 0 } }),
      daily,
    );
    expect(board.entries.find((e) => e.id === "u-alice")!.stat.points).toBe(10);
  });

  it("composition is pure — the same rows always produce the same board", () => {
    // Rows, not events: a re-render or a repeated compose can never accumulate.
    const rows = [
      call("u-alice", "2026-08-28T15:00:00Z", "appointment_booked", 90),
      call("u-bob", "2026-08-28T15:05:00Z", "qualified", 45),
    ];
    const a = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    const b = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    expect(a).toEqual(b);
  });
});

describe("minTalkSecForConnect gate", () => {
  it("a connected outcome under the talk threshold does not score as a connect", () => {
    const rows = [call("u-alice", "2026-08-28T15:00:00Z", "qualified", 10)];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    const s = board.entries.find((e) => e.id === "u-alice")!.stat;
    expect(s.connects).toBe(0);
    expect(s.talkSec).toBe(0); // sub-threshold talk buys nothing
    expect(s.qualified).toBe(1); // the outcome itself still counts
  });

  it("unknown talk time (legacy rows) is NOT gated", () => {
    const rows = [call("u-alice", "2026-08-28T15:00:00Z", "qualified")];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    expect(board.entries.find((e) => e.id === "u-alice")!.stat.connects).toBe(1);
  });

  it("voicemail never connects regardless of talk time", () => {
    const rows = [call("u-alice", "2026-08-28T15:00:00Z", "voicemail", 600)];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    expect(board.entries.find((e) => e.id === "u-alice")!.stat.connects).toBe(0);
  });
});

describe("AI exclusion", () => {
  const rows = [
    call("u-alice", "2026-08-28T15:00:00Z", "qualified", 60, "ai"),
    call("u-alice", "2026-08-28T15:05:00Z", "qualified", 60, "human"),
  ];

  it("AI calls are invisible by default (points AND counts)", () => {
    const board = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    const s = board.entries.find((e) => e.id === "u-alice")!.stat;
    expect(s.calls).toBe(1);
    expect(s.aiCalls).toBe(0);
    expect(s.connects).toBe(1);
    expect(s.points).toBe(1 + 3 + 0.1);
  });

  it("includeAiCalls brings them back in", () => {
    const board = composeLeaderboard(
      rows,
      MEMBERS,
      cfg({ exclusions: { includeAiCalls: true, minTalkSecForConnect: 30 } }),
      daily,
    );
    const s = board.entries.find((e) => e.id === "u-alice")!.stat;
    expect(s.calls).toBe(2);
    expect(s.aiCalls).toBe(1);
    expect(s.connects).toBe(2);
  });
});

describe("calendar-true periods (org tz)", () => {
  it("daily window is the org-tz day: 04:59Z is yesterday, 05:01Z is today (CDT)", () => {
    const rows = [
      call("u-alice", "2026-08-28T04:59:00Z", "qualified", 60), // 23:59 Aug 27 CDT
      call("u-alice", "2026-08-28T05:01:00Z", "qualified", 60), // 00:01 Aug 28 CDT
    ];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    expect(board.period).toMatchObject({ key: "daily", fromKey: "2026-08-28", toKey: "2026-08-28" });
    expect(board.entries.find((e) => e.id === "u-alice")!.stat.connects).toBe(1);
  });

  it("weekly spans the spring-forward DST week without losing boundary days", () => {
    // Tue 2026-03-10 13:00 CDT — Sunday-start week contains the 23-hour Mar 8.
    const now = Date.parse("2026-03-10T18:00:00Z");
    const rows = [
      call("u-alice", "2026-03-08T07:00:00Z", "qualified", 60), // 01:00 CST Mar 8 → in
      call("u-alice", "2026-03-08T05:59:00Z", "qualified", 60), // 23:59 CST Mar 7 → out
    ];
    const board = composeLeaderboard(rows, MEMBERS, cfg({ weekStart: 0 }), {
      period: "weekly",
      tz: TZ,
      now,
    });
    expect(board.period.fromKey).toBe("2026-03-08");
    expect(board.period.toKey).toBe("2026-03-14");
    expect(board.entries.find((e) => e.id === "u-alice")!.stat.connects).toBe(1);
  });

  it("weekly spans the fall-back DST week (2026-11-01) correctly", () => {
    // Tue 2026-11-03, CST. Sunday-start week = Nov 1 – Nov 7 (25-hour Nov 1).
    const now = Date.parse("2026-11-03T18:00:00Z");
    const rows = [
      call("u-alice", "2026-11-01T06:30:00Z", "qualified", 60), // 01:30 CDT Nov 1 → in
      call("u-alice", "2026-11-01T04:59:00Z", "qualified", 60), // 23:59 CDT Oct 31 → out
    ];
    const board = composeLeaderboard(rows, MEMBERS, cfg({ weekStart: 0 }), {
      period: "weekly",
      tz: TZ,
      now,
    });
    expect(board.period.fromKey).toBe("2026-11-01");
    expect(board.period.toKey).toBe("2026-11-07");
    expect(board.entries.find((e) => e.id === "u-alice")!.stat.connects).toBe(1);
  });

  it("weekly crosses the year boundary and weekStart 0 vs 1 shifts the window", () => {
    // Thu 2026-01-01, 12:00 CST.
    const now = Date.parse("2026-01-01T18:00:00Z");
    const monday = composeLeaderboard([], MEMBERS, cfg({ weekStart: 1 }), {
      period: "weekly",
      tz: TZ,
      now,
    });
    expect(monday.period).toMatchObject({ fromKey: "2025-12-29", toKey: "2026-01-04" });
    const sunday = composeLeaderboard([], MEMBERS, cfg({ weekStart: 0 }), {
      period: "weekly",
      tz: TZ,
      now,
    });
    expect(sunday.period).toMatchObject({ fromKey: "2025-12-28", toKey: "2026-01-03" });
  });

  it("monthly is the calendar month, edges in org time", () => {
    const rows = [
      call("u-alice", "2026-08-01T05:00:00Z", "qualified", 60), // 00:00 CDT Aug 1 → in
      call("u-alice", "2026-08-01T04:59:00Z", "qualified", 60), // 23:59 CDT Jul 31 → out
    ];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), { period: "monthly", tz: TZ, now: NOW });
    expect(board.period).toMatchObject({ key: "monthly", fromKey: "2026-08-01", toKey: "2026-08-31" });
    expect(board.period.label).toBe("August 2026");
    expect(board.entries.find((e) => e.id === "u-alice")!.stat.connects).toBe(1);
  });

  it("zonedMonthRange enumerates every day of the month once", () => {
    const { fromKey, toKey, days } = zonedMonthRange(new Date("2026-02-10T12:00:00Z"), TZ);
    expect(fromKey).toBe("2026-02-01");
    expect(toKey).toBe("2026-02-28");
    expect(days).toHaveLength(28);
    expect(new Set(days).size).toBe(28);
  });
});

describe("deterministic ties", () => {
  it("falls through points → connects → talkSec → earliest → userId", () => {
    // Identical everything ⇒ userId decides, stably.
    const rows = [
      call("u-alice", "2026-08-28T15:00:00Z", "qualified", 60),
      call("u-bob", "2026-08-28T15:00:00Z", "qualified", 60),
    ];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    expect(board.entries.map((e) => e.id)).toEqual(["u-alice", "u-bob"]);
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2]);

    // Same points/connects/talk, but Bob acted EARLIER ⇒ Bob wins.
    const rows2 = [
      call("u-alice", "2026-08-28T15:00:00Z", "qualified", 60),
      call("u-bob", "2026-08-28T14:00:00Z", "qualified", 60),
    ];
    const board2 = composeLeaderboard(rows2, MEMBERS, cfg(), daily);
    expect(board2.entries.map((e) => e.id)).toEqual(["u-bob", "u-alice"]);

    // Same points + connects, more talk wins (talkMinute at 0 keeps points equal).
    const noTalkPoints = cfg({
      points: { ...DEFAULT_LEADERBOARD.points, talkMinute: 0 },
    });
    const rows3 = [
      call("u-alice", "2026-08-28T15:00:00Z", "qualified", 300),
      call("u-bob", "2026-08-28T14:00:00Z", "qualified", 60),
    ];
    const board3 = composeLeaderboard(rows3, MEMBERS, noTalkPoints, daily);
    expect(board3.entries.map((e) => e.id)).toEqual(["u-alice", "u-bob"]);
  });

  it("compareRanked is a strict total order on distinct ids", () => {
    const s = (points: number) => ({
      points,
      connects: 0,
      talkSec: 0,
      firstActivityMs: null,
    });
    const a = { id: "a", stat: s(1) };
    const b = { id: "b", stat: s(1) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(compareRanked(a as any, b as any)).toBeLessThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(compareRanked(b as any, a as any)).toBeGreaterThan(0);
  });
});

describe("streaks + personal best", () => {
  it("counts consecutive org-tz days with a connect; today-without-one doesn't break it", () => {
    const rows = [
      // Alice: connects today, yesterday, and the day before → streak 3.
      call("u-alice", "2026-08-28T15:00:00Z", "qualified", 60),
      call("u-alice", "2026-08-27T15:00:00Z", "qualified", 60),
      call("u-alice", "2026-08-26T15:00:00Z", "qualified", 60),
      // Bob: connect yesterday only (nothing today yet) → streak 1, not 0.
      call("u-bob", "2026-08-27T15:00:00Z", "qualified", 60),
    ];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    expect(board.entries.find((e) => e.id === "u-alice")!.streakDays).toBe(3);
    expect(board.entries.find((e) => e.id === "u-bob")!.streakDays).toBe(1);
  });

  it("a gap breaks the streak", () => {
    const rows = [
      call("u-alice", "2026-08-28T15:00:00Z", "qualified", 60), // today
      call("u-alice", "2026-08-26T15:00:00Z", "qualified", 60), // two days ago
    ];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    expect(board.entries.find((e) => e.id === "u-alice")!.streakDays).toBe(1);
  });

  it("personal best is the single best org-tz day by points across the supplied rows", () => {
    const rows = [
      // Aug 20: appointment (5) + connect (1) + 1 talk min (0.1) = 6.1
      call("u-alice", "2026-08-20T15:00:00Z", "appointment_booked", 60),
      // Aug 28: connect (1) + 1 talk min (0.1) = 1.1
      call("u-alice", "2026-08-28T15:00:00Z", "qualified", 60),
    ];
    const board = composeLeaderboard(rows, MEMBERS, cfg(), daily);
    const alice = board.entries.find((e) => e.id === "u-alice")!;
    expect(alice.personalBestPoints).toBe(6.1);
    expect(alice.personalBestDay).toBe("2026-08-20");
  });
});
