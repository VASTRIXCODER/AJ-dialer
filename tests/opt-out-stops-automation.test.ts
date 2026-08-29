import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./helpers/fake-supabase";

// ─────────────────────────────────────────────────────────────────────────────
// A customer who says STOP must stop EVERYTHING.
//
// `addToDnc` writes the suppression list, which stops future dials because the
// dial paths scrub against it. But a running playbook reads
// `opportunities.stage`, and nothing connected the two — so an opt-out blocked
// the calls while the automation kept escalating the same person and kept
// creating call tasks about them. That was live.
//
// Two independent mechanisms now hold the line, and both are pinned here:
//   1. the STOP webhook closes the opportunity, and
//   2. the engine consults the suppression list directly, so the rule holds
//      even for an opt-out path that forgets step 1.
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

import { orchestrationTick } from "@/lib/orchestration/engine";
import { suppressOpportunitiesForPhone } from "@/lib/db/opportunities";
import { CUSTOMER_REVERSIBLE_SOURCES, removeFromDnc } from "@/lib/db/dnc";
import { SPEED_TO_LEAD } from "@/lib/orchestration/templates";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const LEAD_DUP = "22222222-2222-4222-8222-2222222222d2";
const OPP = "33333333-3333-4333-8333-333333333333";
const OPP_DUP = "33333333-3333-4333-8333-3333333333d3";
const PHONE = "+15105550143";
const NOW = new Date("2026-08-29T15:00:00.000Z");

function world(opts: { duplicateLead?: boolean } = {}) {
  db.tables.clear();
  db.seed("app_settings", [{ id: "global", orchestration_paused: false }]);
  db.seed("organizations", [
    { id: ORG, settings: { orchestration: { enabled: true } }, timezone: "America/Chicago" },
  ]);
  db.seed("playbooks", [
    { id: "pb-1", org_id: ORG, version: 1, status: "published", definition: SPEED_TO_LEAD },
  ]);
  const opps = [
    {
      id: OPP,
      org_id: ORG,
      lead_id: LEAD,
      stage: "attempting",
      op_status: "open",
      owner_id: null,
      attempt_count: 0,
      contact_count: 0,
    },
  ];
  const leads = [{ id: LEAD, org_id: ORG, status: "no_answer", phone: PHONE }];
  if (opts.duplicateLead) {
    // The same human on two rows — normal in an imported book.
    opps.push({ ...opps[0], id: OPP_DUP, lead_id: LEAD_DUP });
    leads.push({ id: LEAD_DUP, org_id: ORG, status: "new", phone: PHONE });
  }
  db.seed("opportunities", opps);
  db.seed("leads", leads);
  db.seed("dnc_numbers", []);
  db.seed("opportunity_events", []);
  db.seed("playbook_instances", [
    {
      id: "inst-1",
      org_id: ORG,
      playbook_id: "pb-1",
      playbook_version: 1,
      opportunity_id: OPP,
      status: "active",
      current_step: 0,
      started_at: "2026-08-29T14:00:00.000Z",
    },
  ]);
  db.seed("playbook_executions", []);
  db.seed("work_items", []);
  db.seed("signals", []);
  db.seed("callbacks", []);
  db.seed("call_records", []);
}

beforeEach(() => vi.clearAllMocks());

describe("the STOP webhook closes the opportunity", () => {
  it("suppresses an open opportunity so the automation has nothing to work", async () => {
    world();
    const closed = await suppressOpportunitiesForPhone({
      orgId: ORG,
      phone: PHONE,
      reason: "sms_stop",
    });
    expect(closed).toBe(1);
    const opp = db.rows("opportunities").find((o) => o.id === OPP);
    expect(opp?.stage).toBe("dnc_suppressed");
    expect(opp?.op_status).toBe("closed");
  });

  it("suppresses EVERY lead row carrying that number, not just the first", async () => {
    // Stopping one of a person's duplicate rows is not stopping.
    world({ duplicateLead: true });
    const closed = await suppressOpportunitiesForPhone({ orgId: ORG, phone: PHONE });
    expect(closed).toBe(2);
    for (const o of db.rows("opportunities")) expect(o.stage).toBe("dnc_suppressed");
  });

  it("matches on the last ten digits, not a substring", async () => {
    // The coarse `ilike %digits%` prefilter matches anything CONTAINING the
    // digits; the exact last-ten comparison is what stops a different person
    // whose number merely contains them from being suppressed.
    world();
    db.rows("leads")[0].phone = "+15105550143999";
    const closed = await suppressOpportunitiesForPhone({ orgId: ORG, phone: PHONE });
    expect(closed).toBe(0);
    expect(db.rows("opportunities")[0].stage).toBe("attempting");
  });

  it("never reaches into another tenant", async () => {
    world();
    const closed = await suppressOpportunitiesForPhone({
      orgId: "99999999-9999-4999-8999-999999999999",
      phone: PHONE,
    });
    expect(closed).toBe(0);
    expect(db.rows("opportunities")[0].stage).toBe("attempting");
  });
});

describe("opting back in undoes only a texting opt-out", () => {
  // "YES" is a START word. Without this fence, a one-word reply to any question
  // would re-open dialing on someone who told a rep on the phone to stop.
  const opts = { onlySources: CUSTOMER_REVERSIBLE_SOURCES };

  beforeEach(() => {
    world();
    db.seed("dnc_numbers", [
      { id: "d-sms", org_id: ORG, phone_digits: "5105550143", source: "sms_stop" },
      { id: "d-rep", org_id: ORG, phone_digits: "5105550199", source: "rep_disposition" },
    ]);
  });

  it("lifts the row the customer's own STOP created", async () => {
    await removeFromDnc(ORG, PHONE, opts);
    expect(db.rows("dnc_numbers").map((r) => r.id)).toEqual(["d-rep"]);
  });

  it("leaves a rep's Do Not Call disposition in place", async () => {
    await removeFromDnc(ORG, "+15105550199", opts);
    expect(db.rows("dnc_numbers").map((r) => r.id)).toEqual(["d-sms", "d-rep"]);
  });

  it("an unrestricted removal — the Admin screen — still lifts anything", async () => {
    await removeFromDnc(ORG, "+15105550199");
    expect(db.rows("dnc_numbers").map((r) => r.id)).toEqual(["d-sms"]);
  });
});

describe("the engine independently honours the suppression list", () => {
  it("stops a running playbook when the number is on the DNC list", async () => {
    // The stage is deliberately left untouched — this is the fail-safe for any
    // opt-out path that writes the list and forgets the opportunity.
    world();
    db.seed("dnc_numbers", [
      { id: "d1", org_id: ORG, phone_digits: "5105550143", source: "sms_stop" },
    ]);
    const r = await orchestrationTick(NOW);
    expect(r.stopped).toBe(1);
    expect(r.executed).toBe(0);
    const inst = db.rows("playbook_instances")[0];
    expect(inst.status).toBe("stopped");
    expect(inst.stopped_reason).toBe("dnc_or_opt_out");
    expect(db.rows("work_items")).toHaveLength(0);
  });

  it("runs normally when the number is not suppressed", async () => {
    world();
    const r = await orchestrationTick(NOW);
    expect(r.stopped).toBe(0);
    expect(r.executed).toBe(1);
  });

  it("one tenant's suppression list cannot stop another tenant's playbook", async () => {
    world();
    db.seed("dnc_numbers", [
      {
        id: "d2",
        org_id: "99999999-9999-4999-8999-999999999999",
        phone_digits: "5105550143",
        source: "sms_stop",
      },
    ]);
    const r = await orchestrationTick(NOW);
    expect(r.stopped).toBe(0);
    expect(r.executed).toBe(1);
  });
});
