import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./helpers/fake-supabase";

// ─────────────────────────────────────────────────────────────────────────────
// The shared queue, executed rather than read.
//
// The bug this file exists to prevent: the claimable predicate matches
// `pending` OR `reserved`-and-EXPIRED. The instant a rep claims something it
// becomes reserved with a lease in the FUTURE, matching neither — so it
// disappeared from the screen. Clicking "Claim 5" made five rows vanish and
// left a Release button referring to work nobody could see, while the lease
// countdown that exists specifically to prevent "why did my work vanish" could
// never render, because no row carrying an unexpired lease was ever returned.
//
// The list is now "what I hold" ∪ "what anyone may claim". The COUNT stays
// strictly claimable, because "Claim 5 of 12" has to mean twelve are free.
// ─────────────────────────────────────────────────────────────────────────────

const db = new FakeSupabase();

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => db,
}));
vi.mock("@/lib/telemetry", () => ({ count: vi.fn(), timing: vi.fn() }));

import { getCrmQueue } from "@/lib/db/crm";
import type { Scope } from "@/lib/db/scope";

const ORG = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-30T12:00:00.000Z");

const me: Scope = { userId: ME, orgId: ORG, supervisor: true };

const future = new Date(NOW.getTime() + 4 * 60_000).toISOString();
const past = new Date(NOW.getTime() - 60_000).toISOString();

function world() {
  db.tables.clear();
  db.clock = NOW;
  vi.setSystemTime(NOW);
  db.seed("work_items", [
    // Free to claim.
    { id: "free-1", org_id: ORG, type: "first_call", reason: "speed_to_lead", status: "pending", priority: 90, due_at: null, owner_id: null, lead_id: "lead-1" },
    { id: "free-2", org_id: ORG, type: "follow_up_call", reason: "no_answer_retry", status: "pending", priority: 50, due_at: past, owner_id: null, lead_id: "lead-2" },
    // Someone else's lease has expired, so it is claimable again.
    { id: "expired", org_id: ORG, type: "callback", reason: "promised", status: "reserved", priority: 70, due_at: null, owner_id: null, reserved_by: OTHER, reserved_until: past, lead_id: "lead-3" },
    // I AM HOLDING THIS. It used to vanish.
    { id: "mine", org_id: ORG, type: "hot_response", reason: "callback_breach", status: "reserved", priority: 95, due_at: null, owner_id: null, reserved_by: ME, reserved_until: future, lead_id: "lead-4" },
    // Someone else holds this, lease still live — not mine, not claimable.
    { id: "theirs", org_id: ORG, type: "first_call", reason: "speed_to_lead", status: "reserved", priority: 60, due_at: null, owner_id: null, reserved_by: OTHER, reserved_until: future, lead_id: "lead-5" },
    // Assigned to another rep — never claimable by me.
    { id: "assigned_away", org_id: ORG, type: "first_call", reason: "x", status: "pending", priority: 80, due_at: null, owner_id: OTHER, lead_id: "lead-6" },
    // Not due yet.
    { id: "future_due", org_id: ORG, type: "follow_up_call", reason: "x", status: "pending", priority: 80, due_at: "2099-01-01T00:00:00.000Z", owner_id: null, lead_id: "lead-7" },
    // Finished.
    { id: "done", org_id: ORG, type: "first_call", reason: "x", status: "completed", priority: 90, due_at: null, owner_id: null, lead_id: "lead-8" },
    // Another tenant entirely.
    { id: "other_org", org_id: "99999999-9999-4999-8999-999999999999", type: "first_call", reason: "x", status: "pending", priority: 99, due_at: null, owner_id: null, lead_id: "lead-9" },
  ]);
  db.seed("leads", [
    { id: "lead-1", org_id: ORG, first_name: "Ada", last_name: "Lovelace", phone: "+13125550001" },
    { id: "lead-4", org_id: ORG, first_name: "Grace", last_name: "Hopper", phone: "+13125550004" },
  ]);
}

beforeEach(() => {
  vi.useFakeTimers();
  world();
});

const ids = (q: Awaited<ReturnType<typeof getCrmQueue>>) =>
  (q?.items ?? []).map((i) => i.id);

describe("what the rep can see", () => {
  it("shows work this rep is HOLDING — the bug that made claims vanish", async () => {
    const q = await getCrmQueue(me);
    expect(ids(q)).toContain("mine");
    const mine = q!.items.find((i) => i.id === "mine")!;
    expect(mine.reservedByMe).toBe(true);
    // Without a lease timestamp the countdown cannot render.
    expect(mine.reservedUntil).toBe(future);
  });

  it("shows free work and reclaimable expired leases", async () => {
    const list = ids(await getCrmQueue(me));
    expect(list).toContain("free-1");
    expect(list).toContain("free-2");
    expect(list).toContain("expired");
  });

  it("hides work another rep is actively holding", async () => {
    expect(ids(await getCrmQueue(me))).not.toContain("theirs");
  });

  it("hides work assigned to someone else", async () => {
    expect(ids(await getCrmQueue(me))).not.toContain("assigned_away");
  });

  it("hides work that is not due yet, and work already finished", async () => {
    const list = ids(await getCrmQueue(me));
    expect(list).not.toContain("future_due");
    expect(list).not.toContain("done");
  });

  it("never crosses into another tenant", async () => {
    expect(ids(await getCrmQueue(me))).not.toContain("other_org");
  });

  it("lists each item once, even though held and claimable are read separately", async () => {
    const list = ids(await getCrmQueue(me));
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("the counts mean what the buttons say", () => {
  it("counts ONLY claimable work, excluding what this rep already holds", async () => {
    // "Claim 5 of N" has to mean N are free. free-1, free-2, expired.
    const q = await getCrmQueue(me);
    expect(q?.claimable).toBe(3);
  });

  it("counts held separately, so Release knows what it would release", async () => {
    const q = await getCrmQueue(me);
    expect(q?.held).toBe(1);
  });

  it("a rep holding everything sees held work and zero claimable", async () => {
    for (const id of ["free-1", "free-2", "expired"]) {
      const row = db.rows("work_items").find((r) => r.id === id)!;
      row.status = "reserved";
      row.reserved_by = ME;
      row.reserved_until = future;
    }
    const q = await getCrmQueue(me);
    expect(q?.claimable).toBe(0);
    expect(q?.held).toBe(4);
    // And crucially, the screen is NOT empty.
    expect(q!.items.length).toBe(4);
  });
});

describe("names and numbers come through", () => {
  it("resolves the contact behind an item", async () => {
    const q = await getCrmQueue(me);
    const held = q!.items.find((i) => i.id === "mine")!;
    expect(held.leadName).toBe("Grace Hopper");
    expect(held.phone).toBe("+13125550004");
  });

  it("renders a dash rather than 'undefined' when the lead row is missing", async () => {
    const q = await getCrmQueue(me);
    const orphan = q!.items.find((i) => i.id === "free-2")!;
    expect(orphan.leadName).toBe("—");
  });
});

describe("the fake models the real predicate", () => {
  it("parses a nested and() inside or() without tearing it in half", async () => {
    // If splitTopLevel regressed, `and(status.eq.reserved,reserved_until.lt.X)`
    // would split on its inner comma and the expired-lease row would be
    // matched (or missed) for entirely the wrong reason.
    const list = ids(await getCrmQueue(me));
    expect(list).toContain("expired"); // reserved AND expired  -> claimable
    expect(list).not.toContain("theirs"); // reserved AND live  -> not claimable
  });

  it("refuses an operator it does not model instead of reading it as false", async () => {
    // or() pushes a lazy filter, so the refusal surfaces when the query RUNS.
    // Silently returning false would quietly narrow a query and let a test pass
    // for entirely the wrong reason.
    await expect(
      db.from("work_items").select("id").or("status.like.pend%"),
    ).rejects.toThrow(/unsupported operator/);
  });
});
