import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./helpers/fake-supabase";

// ─────────────────────────────────────────────────────────────────────────────
// `transitionOpportunityStage` is about to gain a drag-and-drop caller, which
// makes two of its properties load-bearing in a way they were not before:
//
//   1. the return value must mean "the stage moved", so the board can tell the
//      rep their drag lost a race instead of snapping the card and lying;
//   2. `opportunity_events` must not record transitions that did not happen.
//      The table is append-only (a trigger refuses UPDATE and DELETE), so a
//      fabricated row is permanent — there is no cleanup path, ever.
//
// Both used to be wrong: the event was written BEFORE the compare-and-set, and
// the function returned `true` whether or not the set matched a row.
// ─────────────────────────────────────────────────────────────────────────────

const db = new FakeSupabase();

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => db,
}));
vi.mock("@/lib/telemetry", () => ({ count: vi.fn(), timing: vi.fn() }));
vi.mock("@/lib/db/lead-events", () => ({
  logLeadEvent: vi.fn(),
  logLeadEventBulk: vi.fn(),
  logDncEventForPhone: vi.fn(),
}));

import { transitionOpportunityStage } from "@/lib/db/opportunities";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const OPP = "33333333-3333-4333-8333-333333333333";

function world(stage = "contacted") {
  db.tables.clear();
  db.seed("opportunities", [
    { id: OPP, org_id: ORG, lead_id: "lead-1", stage, op_status: "open" },
  ]);
  db.seed("opportunity_events", []);
}

const move = (over: Record<string, unknown> = {}) =>
  transitionOpportunityStage({
    opportunityId: OPP,
    orgId: ORG,
    from: "contacted",
    to: "interested",
    actor: "rep",
    ...over,
  } as Parameters<typeof transitionOpportunityStage>[0]);

beforeEach(() => vi.clearAllMocks());

describe("a move that lands", () => {
  it("reports true, moves the stage, and logs it once", async () => {
    world();
    expect(await move()).toBe(true);
    expect(db.rows("opportunities")[0].stage).toBe("interested");
    const events = db.rows("opportunity_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      opportunity_id: OPP,
      type: "stage_changed",
      from_stage: "contacted",
      to_stage: "interested",
      actor_kind: "rep",
    });
  });

  it("records system_fulfillment as a system actor", async () => {
    world("appointment_completed");
    expect(
      await move({ from: "appointment_completed", to: "sold", actor: "system_fulfillment" }),
    ).toBe(true);
    expect(db.rows("opportunity_events")[0].actor_kind).toBe("system");
  });
});

describe("a move that loses the race", () => {
  it("reports false when another writer already moved the row", async () => {
    world();
    // Someone else got there first: the row is no longer at `from`.
    db.rows("opportunities")[0].stage = "appointment_booked";
    expect(await move()).toBe(false);
  });

  it("writes NO event for a transition that did not happen", async () => {
    world();
    db.rows("opportunities")[0].stage = "appointment_booked";
    await move();
    // The whole point: an append-only log must not gain a permanent lie.
    expect(db.rows("opportunity_events")).toHaveLength(0);
    expect(db.rows("opportunities")[0].stage).toBe("appointment_booked");
  });

  it("leaves the winner's stage untouched", async () => {
    world();
    db.rows("opportunities")[0].stage = "sold";
    await move();
    expect(db.rows("opportunities")[0].stage).toBe("sold");
  });
});

describe("refusals never touch anything", () => {
  it("a rep cannot reach sold", async () => {
    world("interested");
    expect(await move({ from: "interested", to: "sold" })).toBe(false);
    expect(db.rows("opportunities")[0].stage).toBe("interested");
    expect(db.rows("opportunity_events")).toHaveLength(0);
  });

  it("a backwards move without allowRegress is refused", async () => {
    world("interested");
    expect(await move({ from: "interested", to: "attempting" })).toBe(false);
    expect(db.rows("opportunity_events")).toHaveLength(0);
  });

  it("a backwards move WITH allowRegress by a human lands", async () => {
    world("interested");
    expect(
      await move({ from: "interested", to: "attempting", allowRegress: true }),
    ).toBe(true);
    expect(db.rows("opportunities")[0].stage).toBe("attempting");
  });

  it("nobody leaves suppression but a manager", async () => {
    world("dnc_suppressed");
    expect(await move({ from: "dnc_suppressed", to: "contacted" })).toBe(false);
    expect(
      await move({ from: "dnc_suppressed", to: "contacted", actor: "manager" }),
    ).toBe(true);
  });
});

describe("the tenant fence", () => {
  it("a caller passing another org's id moves nothing and says so", async () => {
    world();
    expect(await move({ orgId: OTHER_ORG })).toBe(false);
    expect(db.rows("opportunities")[0].stage).toBe("contacted");
    expect(db.rows("opportunity_events")).toHaveLength(0);
  });
});

describe("closing writes the closed columns; the two non-endings do not", () => {
  it("a closing stage sets op_status, closed_at and close_reason", async () => {
    world();
    expect(await move({ to: "lost" })).toBe(true);
    const row = db.rows("opportunities")[0];
    expect(row.op_status).toBe("closed");
    expect(row.close_reason).toBe("lost");
    expect(row.closed_at).toBeTruthy();
  });

  it("duplicate closes too — it is an ending, and an open one leaks forever", async () => {
    world();
    expect(await move({ to: "duplicate" })).toBe(true);
    expect(db.rows("opportunities")[0].op_status).toBe("closed");
  });

  it("sold stays open for fulfillment to work", async () => {
    world("appointment_completed");
    await move({ from: "appointment_completed", to: "sold", actor: "manager" });
    const row = db.rows("opportunities")[0];
    expect(row.op_status).toBe("open");
    expect(row.closed_at).toBeUndefined();
  });

  it("nurture stays open — it is a review date, not an ending", async () => {
    world();
    await move({ to: "nurture" });
    expect(db.rows("opportunities")[0].op_status).toBe("open");
  });
});
