import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isValidFloorTopic,
  orgFloorTopic,
  stampEnvelope,
} from "@/lib/realtime/events";

const ORG = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";

describe("orgFloorTopic", () => {
  it("builds org:<uuid>:floor", () => {
    expect(orgFloorTopic(ORG)).toBe(`org:${ORG}:floor`);
  });

  it("lowercases the uuid so it always matches the SQL regex", () => {
    expect(orgFloorTopic(ORG.toUpperCase())).toBe(`org:${ORG}:floor`);
    expect(isValidFloorTopic(orgFloorTopic(ORG.toUpperCase()))).toBe(true);
  });
});

describe("isValidFloorTopic", () => {
  it("accepts exactly the canonical shape", () => {
    expect(isValidFloorTopic(`org:${ORG}:floor`)).toBe(true);
  });

  it.each([
    ["wrong suffix", `org:${ORG}:leads`],
    ["missing suffix", `org:${ORG}`],
    ["wrong prefix", `team:${ORG}:floor`],
    ["uppercase hex (SQL regex is lowercase-only)", `org:${ORG.toUpperCase()}:floor`],
    ["not a uuid", "org:not-a-uuid:floor"],
    ["extra segment", `org:${ORG}:floor:extra`],
    ["leading garbage", `xorg:${ORG}:floor`],
    ["trailing garbage", `org:${ORG}:floorx`],
    ["empty", ""],
    ["wildcard injection", "org:*:floor"],
  ])("rejects %s", (_label, topic) => {
    expect(isValidFloorTopic(topic)).toBe(false);
  });

  // LOCKSTEP: the validator must be behaviorally identical to the regex inside
  // public.app_can_join_org_topic. Extract the pattern straight out of
  // schema.sql and check both sides agree on a battery of topics — if either
  // side's shape ever changes alone, this is the test that fails.
  it("agrees with the app_can_join_org_topic regex in schema.sql", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase", "schema.sql"),
      "utf8",
    );
    const m = sql.match(/topic ~ '([^']+)'/);
    expect(m, "app_can_join_org_topic's regex not found in schema.sql").toBeTruthy();
    const sqlRe = new RegExp(m![1]);

    const samples = [
      `org:${ORG}:floor`,
      `org:${ORG.toUpperCase()}:floor`,
      `org:${ORG}:leads`,
      "org:not-a-uuid:floor",
      `org:${ORG}:floor:extra`,
      `xorg:${ORG}:floor`,
      "org:*:floor",
      "",
      orgFloorTopic("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"),
      "org:00000000-0000-0000-0000-000000000000:floor",
    ];
    for (const topic of samples) {
      expect(isValidFloorTopic(topic), `disagreement on "${topic}"`).toBe(
        sqlRe.test(topic),
      );
    }
  });
});

describe("stampEnvelope", () => {
  it("stamps seq and an ISO `at` without touching the payload's own fields", () => {
    const at = new Date("2026-08-28T12:00:00.000Z");
    const stamped = stampEnvelope<"leaderboard.delta">({ ownerId: "u1" }, 7, at);
    expect(stamped).toEqual({ ownerId: "u1", seq: 7, at: "2026-08-28T12:00:00.000Z" });
  });

  it("does not mutate the input payload", () => {
    const payload = { ownerId: "u1" };
    stampEnvelope<"leaderboard.delta">(payload, 1);
    expect(payload).toEqual({ ownerId: "u1" });
    expect("seq" in payload).toBe(false);
  });

  it("defaults `at` to now (a parseable ISO timestamp)", () => {
    const before = Date.now();
    const stamped = stampEnvelope<"leaderboard.delta">({ ownerId: null }, 2);
    const t = Date.parse(stamped.at);
    expect(t).toBeGreaterThanOrEqual(before - 1000);
    expect(t).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
