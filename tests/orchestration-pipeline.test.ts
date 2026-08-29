import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./helpers/fake-supabase";

// ─────────────────────────────────────────────────────────────────────────────
// King's pipeline, END TO END: playbook published → event activates an
// instance → the tick executes its steps → work items, signals and next
// actions land → stop rules and kill switches hold.
//
// This is the first test that RUNS the engine. Everything before it exercised
// the pure planning helpers, so the imperative shell — the part that has never
// executed in production — was unverified. The fake enforces the same UNIQUE
// constraints as schema.sql, because exactly-once and activation dedupe ARE
// those constraints.
// ─────────────────────────────────────────────────────────────────────────────

const db = new FakeSupabase();

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => db,
}));
vi.mock("@/lib/telemetry", () => ({ count: vi.fn(), timing: vi.fn() }));

import { orchestrationTick } from "@/lib/orchestration/engine";
import { emitOrchestrationEvent, runOrchestrationSweeps } from "@/lib/orchestration/events";
import {
  NO_ANSWER_FOLLOW_UP,
  PROMISED_CALLBACK_PROTECTION,
  SPEED_TO_LEAD,
} from "@/lib/orchestration/templates";
import type { PlaybookDefinition } from "@/lib/orchestration/definition";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const OPP = "33333333-3333-4333-8333-333333333333";

const NOW = new Date("2026-08-29T15:00:00.000Z");

/** A workspace with orchestration ON and one published playbook. */
function world(
  def: PlaybookDefinition,
  opts: { orgEnabled?: boolean; opp?: Record<string, unknown>; lead?: Record<string, unknown> } = {},
) {
  db.tables.clear();
  db.log = [];
  db.seed("app_settings", [{ id: "global", orchestration_paused: false }]);
  db.seed("organizations", [
    {
      id: ORG,
      settings: { orchestration: { enabled: opts.orgEnabled !== false } },
    },
  ]);
  db.seed("playbooks", [
    { id: "pb-1", org_id: ORG, version: 1, status: "published", definition: def },
  ]);
  db.seed("opportunities", [
    {
      id: OPP,
      org_id: ORG,
      lead_id: LEAD,
      stage: "new",
      op_status: "open",
      owner_id: null,
      attempt_count: 0,
      contact_count: 0,
      first_contacted_at: null,
      last_touched_at: null,
      next_action_kind: null,
      next_action_due_at: null,
      created_at: "2026-08-29T14:00:00.000Z",
      ...(opts.opp ?? {}),
    },
  ]);
  db.seed("leads", [
    {
      id: LEAD,
      org_id: ORG,
      status: "new",
      phone: "+15105550143",
      timezone: "America/Chicago",
      created_at: "2026-08-29T14:00:00.000Z",
      ...(opts.lead ?? {}),
    },
  ]);
  db.seed("playbook_instances", []);
  db.seed("playbook_executions", []);
  db.seed("work_items", []);
  db.seed("signals", []);
  db.seed("callbacks", []);
}

const instances = () => db.rows("playbook_instances");
const workItems = () => db.rows("work_items");
const signals = () => db.rows("signals");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hop 1→2: an event activates a published playbook", () => {
  it("lead.received starts an instance at step 0", async () => {
    world(SPEED_TO_LEAD);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    expect(instances()).toHaveLength(1);
    expect(instances()[0]).toMatchObject({
      org_id: ORG,
      playbook_id: "pb-1",
      opportunity_id: OPP,
      status: "active",
      current_step: 0,
    });
  });

  it("activates nothing while the org kill switch is off", async () => {
    world(SPEED_TO_LEAD, { orgEnabled: false });
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    expect(instances()).toHaveLength(0);
  });

  it("a replayed event cannot double-activate (the partial unique holds)", async () => {
    world(SPEED_TO_LEAD);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    expect(instances()).toHaveLength(1);
  });

  it("eligibility gates activation — a DNC lead never starts a playbook", async () => {
    world(SPEED_TO_LEAD, { lead: { status: "dnc" } });
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    expect(instances()).toHaveLength(0);
  });

  it("the trigger filter gates on the touch — a connected call does not start no-answer follow-up", async () => {
    world(NO_ANSWER_FOLLOW_UP, { opp: { stage: "contacted", attempt_count: 1 } });
    await emitOrchestrationEvent({
      orgId: ORG,
      leadId: LEAD,
      event: "call.completed",
      touch: { outcome: "qualified" },
    });
    expect(instances()).toHaveLength(0);

    await emitOrchestrationEvent({
      orgId: ORG,
      leadId: LEAD,
      event: "call.completed",
      touch: { outcome: "no_answer" },
    });
    expect(instances()).toHaveLength(1);
  });
});

describe("hop 2: the tick executes steps", () => {
  it("runs speed-to-lead end to end: work item → wait → escalation signal", async () => {
    world(SPEED_TO_LEAD);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });

    // Step 0 — create_work_item.
    let r = await orchestrationTick(NOW);
    expect(r.executed).toBe(1);
    expect(workItems()).toHaveLength(1);
    expect(workItems()[0]).toMatchObject({
      org_id: ORG,
      type: "first_call",
      reason: "speed_to_lead",
      priority: 90,
      source_kind: "playbook",
    });
    // Due 5 minutes out, per the template.
    expect(workItems()[0].due_at).toBe(new Date(NOW.getTime() + 5 * 60_000).toISOString());

    // Step 1 — wait 15 minutes: the instance parks.
    r = await orchestrationTick(NOW);
    expect(instances()[0]).toMatchObject({ status: "waiting", current_step: 2 });
    expect(instances()[0].wait_until).toBe(
      new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    );

    // Still waiting a minute later — nothing runs.
    r = await orchestrationTick(new Date(NOW.getTime() + 60_000));
    expect(r.executed).toBe(0);
    expect(signals()).toHaveLength(0);

    // Past the wait: woken, then step 2 escalates into a signal.
    const later = new Date(NOW.getTime() + 16 * 60_000);
    r = await orchestrationTick(later);
    expect(r.woken).toBe(1);
    expect(r.executed).toBe(1);
    expect(signals()).toHaveLength(1);
    expect(signals()[0]).toMatchObject({
      org_id: ORG,
      type: "escalation:speed_to_lead_breach",
      severity: 4,
    });

    // Steps exhausted — the instance completes.
    expect(instances()[0].status).toBe("completed");
  });

  it("set_next_action stamps the opportunity", async () => {
    const def: PlaybookDefinition = {
      ...SPEED_TO_LEAD,
      steps: [
        {
          id: "park",
          kind: "set_next_action",
          next: { kind: "nurture_review", dueInDays: 30 },
        },
      ],
    };
    world(def);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    await orchestrationTick(NOW);
    const opp = db.rows("opportunities")[0];
    expect(opp.next_action_kind).toBe("nurture_review");
    expect(opp.next_action_due_at).toBe(
      new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    );
  });
});

describe("exactly-once", () => {
  it("a replayed tick cannot execute the same step twice", async () => {
    world(SPEED_TO_LEAD);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    await orchestrationTick(NOW);
    expect(workItems()).toHaveLength(1);

    // Simulate a crash between the execution gate and the step advance: the
    // instance is still pointing at step 0, and the execution row exists.
    instances()[0].current_step = 0;

    const r = await orchestrationTick(NOW);
    // The action must NOT run again...
    expect(workItems()).toHaveLength(1);
    // ...and the instance must not be stuck on that step forever.
    expect(instances()[0].current_step).toBeGreaterThan(0);
    expect(r.failed).toBe(0);
  });
});

describe("kill switches", () => {
  it("the global switch halts every tick", async () => {
    world(SPEED_TO_LEAD);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    db.rows("app_settings")[0].orchestration_paused = true;
    const r = await orchestrationTick(NOW);
    expect(r.skipped).toContain("orchestration_paused");
    expect(workItems()).toHaveLength(0);
  });

  it("turning the org switch off freezes instances already running", async () => {
    world(SPEED_TO_LEAD);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    (db.rows("organizations")[0].settings as Record<string, unknown>).orchestration = {
      enabled: false,
    };
    const r = await orchestrationTick(NOW);
    expect(r.executed).toBe(0);
    expect(workItems()).toHaveLength(0);
  });

  it("a paused playbook executes nothing; a retired one stops its instances", async () => {
    world(SPEED_TO_LEAD);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    db.rows("playbooks")[0].status = "paused";
    expect((await orchestrationTick(NOW)).executed).toBe(0);

    db.rows("playbooks")[0].status = "retired";
    const r = await orchestrationTick(NOW);
    expect(r.stopped).toBe(1);
    expect(instances()[0].status).toBe("stopped");
  });
});

describe("stop rules", () => {
  it("a lead who gets contacted mid-playbook stops the sequence", async () => {
    world(SPEED_TO_LEAD);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    await orchestrationTick(NOW); // step 0

    // The rep reached them: `attempted` is one of speed-to-lead's stop rules.
    db.rows("opportunities")[0].last_touched_at = new Date(
      NOW.getTime() + 60_000,
    ).toISOString();

    const r = await orchestrationTick(new Date(NOW.getTime() + 120_000));
    expect(r.stopped).toBe(1);
    expect(instances()[0].status).toBe("stopped");
    expect(instances()[0].stopped_reason).toBe("attempted");
    expect(signals()).toHaveLength(0); // the escalation never fires
  });

  it("DNC stops a running playbook even when it is not in the rule list", async () => {
    const def: PlaybookDefinition = { ...SPEED_TO_LEAD, stop: { rules: [] } };
    world(def);
    await emitOrchestrationEvent({ orgId: ORG, leadId: LEAD, event: "lead.received" });
    db.rows("opportunities")[0].stage = "dnc_suppressed";
    const r = await orchestrationTick(NOW);
    expect(r.stopped).toBe(1);
    expect(instances()[0].stopped_reason).toBe("dnc_or_opt_out");
  });

  it("maxAttempts counts attempts made SINCE activation, not the lead's lifetime", async () => {
    // A lead dialed 4 times already, now activating no-answer follow-up
    // (eligibility allows attempt_count < 6). maxAttempts is 4. If the cap is
    // read as a lifetime total the playbook stops before doing anything —
    // it could never help exactly the leads it exists for.
    world(NO_ANSWER_FOLLOW_UP, {
      opp: { stage: "attempting", attempt_count: 4, last_touched_at: null },
    });
    await emitOrchestrationEvent({
      orgId: ORG,
      leadId: LEAD,
      event: "call.completed",
      touch: { outcome: "no_answer" },
    });
    expect(instances()).toHaveLength(1);

    const r = await orchestrationTick(NOW);
    expect(r.stopped).toBe(0);
    expect(instances()[0].status).not.toBe("stopped");
  });
});

describe("sweep trigger", () => {
  it("an overdue promised callback activates and escalates to the owner", async () => {
    world(PROMISED_CALLBACK_PROTECTION);
    // Promised for 09:00 local (America/Chicago). "now" is 15:00Z = 10:00 local,
    // so it is genuinely one hour overdue — well past the 10-minute threshold.
    db.seed("callbacks", [
      {
        id: "cb-1",
        org_id: ORG,
        lead_id: LEAD,
        status: "due",
        due_at: "2026-08-29T09:00:00",
      },
    ]);
    // 15:00Z is minute-of-day 900, divisible by the 15-minute interval.
    const swept = await runOrchestrationSweeps(NOW);
    expect(swept.activated).toBe(1);

    const r = await orchestrationTick(NOW);
    expect(r.executed).toBe(1);
    expect(signals()[0]).toMatchObject({
      type: "escalation:promised_callback_overdue",
    });
  });

  it("a callback promised for LATER today is not treated as overdue", async () => {
    world(PROMISED_CALLBACK_PROTECTION);
    // due_at is a FLOATING wall clock (see appointments/time.ts): "11:00" means
    // 11:00 in the org's zone. `now` is 15:00Z = 10:00 America/Chicago, so the
    // promise is an hour AWAY and nothing is broken.
    //
    // Comparing the stored digits against a real UTC instant instead makes
    // 11:00 look four hours overdue — which would nudge the owner and raise a
    // hot work item over a promise the rep has not broken.
    db.seed("callbacks", [
      {
        id: "cb-2",
        org_id: ORG,
        lead_id: LEAD,
        status: "due",
        due_at: "2026-08-29T11:00:00",
      },
    ]);
    const swept = await runOrchestrationSweeps(NOW);
    expect(swept.activated).toBe(0);
    expect(instances()).toHaveLength(0);
  });

  it("sweeps respect the org kill switch", async () => {
    world(PROMISED_CALLBACK_PROTECTION, { orgEnabled: false });
    db.seed("callbacks", [
      { id: "cb-3", org_id: ORG, lead_id: LEAD, status: "due", due_at: "2026-08-29T09:00:00" },
    ]);
    const swept = await runOrchestrationSweeps(NOW);
    expect(swept.activated).toBe(0);
  });
});
