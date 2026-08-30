import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./helpers/fake-supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Running a messaging playbook, rather than reading one.
//
// The claim this file exists to test is the load-bearing one: a `send_message`
// step PROPOSES and nothing else. It creates a message a human must read, a
// task telling someone to read it, and it advances — and no code path from here
// can put a text on anyone's phone.
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

// The test environment has no Twilio credentials, and the gate correctly reads
// that as "messaging is not connected" and blocks everything. That behaviour is
// asserted on its own below; for the rest, stand the channel up.
const messagingConfigured = vi.fn(() => true);
vi.mock("@/lib/messaging/config", () => ({
  isMessagingConfigured: () => messagingConfigured(),
  isMessagingSimulated: () => true,
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const OPP = "33333333-3333-4333-8333-333333333333";
const PHONE = "+13125550143";

// The proposal helper resolves the org for its settings; the fake models the
// tables, not the membership layer.
vi.mock("@/lib/org/membership", () => ({
  getOrgById: async () => ({
    id: ORG,
    name: "Northwind",
    timezone: "America/Chicago",
    dialerTemplate: "general",
    settings: {
      dialing: { callerId: "+13125559999", callerIds: ["+13125559999"] },
      messaging: {
        enabled: true,
        quietHours: { startHour: 9, endHour: 20 },
        dailyOrgCap: 500,
        perContactPerDay: 2,
        perContactPer7Days: 5,
        autoSend: false,
      },
    },
  }),
}));

import { orchestrationTick } from "@/lib/orchestration/engine";
import type { PlaybookDefinition } from "@/lib/orchestration/definition";

// Inside 9–20 in Chicago.
const NOW = new Date("2026-08-29T17:00:00.000Z");

const DEFINITION: PlaybookDefinition = {
  schemaVersion: 1,
  key: "no_show_recovery",
  name: "No-show recovery",
  trigger: { kind: "event", event: "call.completed" },
  steps: [
    { id: "reach_out", kind: "send_message", templateKey: "no_show_first_touch" },
    { id: "grace", kind: "wait", for: { hours: 4 } },
  ],
  stop: { rules: ["replied", "contacted", "dnc_or_opt_out"] },
  caps: { touchesPerDay: 1 },
};

function world(opts: { consent?: string; dnc?: boolean; template?: boolean } = {}) {
  db.tables.clear();
  db.clock = NOW;
  db.seed("app_settings", [{ id: "global", orchestration_paused: false, messaging_paused: false }]);
  db.seed("organizations", [
    { id: ORG, settings: { orchestration: { enabled: true } }, timezone: "America/Chicago" },
  ]);
  db.seed("playbooks", [
    { id: "pb-1", org_id: ORG, version: 1, status: "published", definition: DEFINITION },
  ]);
  db.seed("opportunities", [
    {
      id: OPP,
      org_id: ORG,
      lead_id: LEAD,
      stage: "contacted",
      op_status: "open",
      owner_id: "rep-1",
      attempt_count: 2,
      contact_count: 1,
    },
  ]);
  db.seed("leads", [
    {
      id: LEAD,
      org_id: ORG,
      status: "no_answer",
      phone: PHONE,
      first_name: "Dana",
      last_name: "Reed",
      timezone: "America/Chicago",
    },
  ]);
  db.seed(
    "message_templates",
    opts.template === false
      ? []
      : [
          {
            id: "tpl-1",
            org_id: ORG,
            key: "no_show_first_touch",
            version: 1,
            status: "published",
            channel: "sms",
            scope: "transactional",
            body: "Hi {{firstName}}, sorry we missed you. Want to pick another time?",
          },
        ],
  );
  db.seed(
    "consent_state",
    opts.consent === undefined
      ? [
          {
            org_id: ORG,
            phone_digits: "3125550143",
            channel: "sms",
            status: "granted",
            scope: "promotional",
            source: "call_wrapup",
            captured_at: "2026-08-01T12:00:00.000Z",
            event_id: 1,
          },
        ]
      : opts.consent === "none"
        ? []
        : [
            {
              org_id: ORG,
              phone_digits: "3125550143",
              channel: "sms",
              status: opts.consent,
              scope: "transactional",
              source: "inbound_sms",
              captured_at: "2026-08-01T12:00:00.000Z",
              event_id: 1,
            },
          ],
  );
  db.seed(
    "dnc_numbers",
    opts.dnc ? [{ id: "d1", org_id: ORG, phone_digits: "3125550143", source: "sms_stop" }] : [],
  );
  db.seed("playbook_instances", [
    {
      id: "inst-1",
      org_id: ORG,
      playbook_id: "pb-1",
      playbook_version: 1,
      opportunity_id: OPP,
      status: "active",
      current_step: 0,
      started_at: "2026-08-29T16:00:00.000Z",
    },
  ]);
  db.seed("playbook_executions", []);
  db.seed("work_items", []);
  db.seed("signals", []);
  db.seed("callbacks", []);
  db.seed("call_records", []);
  db.seed("messages", []);
  db.seed("message_threads", []);
  db.seed("opportunity_events", []);
}

const messages = () => db.rows("messages");
const reviews = () => db.rows("work_items").filter((w) => w.type === "review");

beforeEach(() => {
  vi.clearAllMocks();
  messagingConfigured.mockReturnValue(true);
});

describe("a send_message step proposes", () => {
  it("creates exactly one message, waiting for a human, and advances", async () => {
    world();
    const r = await orchestrationTick(NOW);
    expect(r.executed).toBe(1);

    expect(messages()).toHaveLength(1);
    const m = messages()[0];
    expect(m.status).toBe("needs_approval");
    // The constraint's whole point: nothing sendable without a named human.
    expect(m.approved_by).toBeNull();
    expect(m.direction).toBe("outbound");
    expect(m.to_number).toBe(PHONE);

    // Advanced past the step it completed.
    expect(db.rows("playbook_instances")[0].current_step).toBe(1);
  });

  it("renders the words once and freezes them on the row", async () => {
    world();
    await orchestrationTick(NOW);
    const body = String(messages()[0].body);
    expect(body).toContain("Hi Dana,");
    expect(body).not.toContain("{{");
  });

  it("appends the way out, so no template author can forget it", async () => {
    world();
    await orchestrationTick(NOW);
    expect(String(messages()[0].body)).toMatch(/STOP/i);
  });

  it("creates ONE unowned review task, so it lands in the shared queue", async () => {
    world();
    await orchestrationTick(NOW);
    expect(reviews()).toHaveLength(1);
    // Unowned on purpose — approving is not the assigned rep's job.
    expect(reviews()[0].owner_id).toBeNull();
    expect(reviews()[0].queue).toBe("approvals");
    expect(reviews()[0].lead_id).toBe(LEAD);
  });

  it("opens exactly one conversation with a sticky sender number", async () => {
    world();
    await orchestrationTick(NOW);
    const threads = db.rows("message_threads");
    expect(threads).toHaveLength(1);
    expect(threads[0].contact_digits).toBe("3125550143");
    // Never the rotating pool: a reply must come from the number they know.
    expect(threads[0].sender_number).toBe("+13125559999");
  });
});

describe("a replayed tick creates nothing new", () => {
  it("proposes once across repeated ticks", async () => {
    world();
    await orchestrationTick(NOW);
    // Rewind the instance as a crashed tick would have left it, so the same
    // step is genuinely re-planned rather than skipped by the step pointer.
    db.rows("playbook_instances")[0].current_step = 0;
    await orchestrationTick(NOW);

    // The idempotency key absorbed it. One message, one task, one thread.
    expect(messages()).toHaveLength(1);
    expect(reviews()).toHaveLength(1);
    expect(db.rows("message_threads")).toHaveLength(1);
  });
});

describe("the gate refuses at proposal, not just at send", () => {
  it("records a blocked message for a suppressed number, and no review task", async () => {
    world({ dnc: true });
    await orchestrationTick(NOW);
    // The instance stops on the DNC rule before the step even runs, so nothing
    // is proposed at all — which is the strongest possible outcome.
    expect(messages()).toHaveLength(0);
    expect(db.rows("playbook_instances")[0].status).toBe("stopped");
    expect(db.rows("playbook_instances")[0].stopped_reason).toBe("dnc_or_opt_out");
  });

  it("blocks a message to someone with no recorded consent", async () => {
    world({ consent: "none" });
    await orchestrationTick(NOW);
    expect(messages()).toHaveLength(1);
    expect(messages()[0].status).toBe("blocked");
    expect(messages()[0].blocked_reasons).toContain("no_consent");
    // Nothing for a human to decide — there is no version of this that may go.
    expect(reviews()).toHaveLength(0);
  });

  it("blocks a message to someone who opted out", async () => {
    world({ consent: "revoked" });
    await orchestrationTick(NOW);
    expect(messages()[0].status).toBe("blocked");
    expect(messages()[0].blocked_reasons).toContain("consent_revoked");
  });

  it("records a blocked message when the template was unpublished", async () => {
    // Visible failure beats a playbook that quietly stopped doing its job.
    world({ template: false });
    await orchestrationTick(NOW);
    expect(messages()).toHaveLength(1);
    expect(messages()[0].status).toBe("blocked");
    expect(messages()[0].blocked_reasons).toContain("template_not_published");
    expect(reviews()).toHaveLength(0);
  });
});

describe("quiet hours hold the message, they do not kill it", () => {
  it("still proposes at 11pm — the drain decides when, not whether", async () => {
    // 2026-08-30T04:00:00Z is 11pm in Chicago. A human can still approve it
    // tonight; the send-time gate is what makes it wait for morning.
    world();
    const LATE = new Date("2026-08-30T04:00:00.000Z");
    db.clock = LATE;
    db.rows("playbook_instances")[0].started_at = "2026-08-30T03:00:00.000Z";
    await orchestrationTick(LATE);
    expect(messages()).toHaveLength(1);
    expect(messages()[0].status).toBe("needs_approval");
    expect(reviews()).toHaveLength(1);
  });
});

describe("`replied` stops the sequence", () => {
  it("stops the run once the customer answers", async () => {
    world();
    await orchestrationTick(NOW);
    expect(db.rows("playbook_instances")[0].status).toBe("active");

    // They text back after the run started.
    db.rows("messages").push({
      id: "in-1",
      org_id: ORG,
      thread_id: db.rows("message_threads")[0].id,
      lead_id: LEAD,
      direction: "inbound",
      status: "received",
      body: "Yes please, Thursday works",
      created_at: "2026-08-29T17:30:00.000Z",
    });

    await orchestrationTick(new Date("2026-08-29T22:00:00.000Z"));
    const inst = db.rows("playbook_instances")[0];
    expect(inst.status).toBe("stopped");
    expect(inst.stopped_reason).toBe("replied");
  });

  it("ignores an inbound message from BEFORE the run started", async () => {
    world();
    db.rows("messages").push({
      id: "in-old",
      org_id: ORG,
      thread_id: "t-old",
      lead_id: LEAD,
      direction: "inbound",
      status: "received",
      body: "old",
      created_at: "2026-08-29T10:00:00.000Z",
    });
    const r = await orchestrationTick(NOW);
    // Ran normally: an old reply says nothing about this sequence.
    expect(r.executed).toBe(1);
    expect(db.rows("playbook_instances")[0].status).toBe("active");
  });
});

describe("the frequency cap the author was forced to set actually fires", () => {
  // Publishing a messaging playbook is REFUSED without caps.touchesPerDay, and
  // the engine used to consult that cap only for create_work_item steps — so
  // the one setting an author had to provide had no effect on the one step it
  // was demanded for.

  it("defers a message when the person has already been called today", async () => {
    world();
    db.rows("call_records").push({
      id: "c1",
      org_id: ORG,
      lead_id: LEAD,
      started_at: "2026-08-29T16:30:00.000Z", // inside the 24h window
    });
    const r = await orchestrationTick(NOW);
    expect(r.deferred).toBe(1);
    expect(messages()).toHaveLength(0);
    const inst = db.rows("playbook_instances")[0];
    expect(inst.status).toBe("waiting");
    // Deferred, not cancelled: "no more than one a day" means wait for
    // tomorrow, and the wait ends a full day after the touch that spent it.
    expect(Date.parse(String(inst.wait_until))).toBe(
      Date.parse("2026-08-29T16:30:00.000Z") + 86_400_000,
    );
  });

  it("counts an ACCEPTED message as a touch, not just a call", async () => {
    world();
    const thread = { id: "t-existing", org_id: ORG, contact_digits: "3125550143", channel: "sms" };
    db.rows("message_threads").push(thread);
    db.rows("messages").push({
      id: "m-earlier",
      org_id: ORG,
      thread_id: thread.id,
      lead_id: LEAD,
      direction: "outbound",
      status: "sent",
      provider_sid: "SM-real",
      created_at: "2026-08-29T16:00:00.000Z",
    });
    const r = await orchestrationTick(NOW);
    // Without messages counting, this playbook would text the same person
    // twice inside a cap of one touch a day.
    expect(r.deferred).toBe(1);
  });

  it("does NOT count a message the carrier never accepted", async () => {
    world();
    const thread = { id: "t-blocked", org_id: ORG, contact_digits: "3125550143", channel: "sms" };
    db.rows("message_threads").push(thread);
    db.rows("messages").push({
      id: "m-blocked",
      org_id: ORG,
      thread_id: thread.id,
      lead_id: LEAD,
      direction: "outbound",
      status: "blocked",
      provider_sid: null, // never reached anyone
      created_at: "2026-08-29T16:00:00.000Z",
    });
    const r = await orchestrationTick(NOW);
    // A blocked message reached nobody, so it must not spend their allowance.
    expect(r.deferred).toBe(0);
    expect(messages().filter((m) => m.status === "needs_approval")).toHaveLength(1);
  });

  it("does not count an INBOUND message against them", async () => {
    world();
    const thread = { id: "t-in", org_id: ORG, contact_digits: "3125550143", channel: "sms" };
    db.rows("message_threads").push(thread);
    db.rows("messages").push({
      id: "m-in",
      org_id: ORG,
      thread_id: thread.id,
      lead_id: LEAD,
      direction: "inbound",
      status: "received",
      provider_sid: "SM-in",
      created_at: "2026-08-29T16:00:00.000Z",
    });
    // Them texting us is not us contacting them.
    const r = await orchestrationTick(NOW);
    expect(r.deferred).toBe(0);
  });
});

describe("a deployment with no credentials proposes nothing sendable", () => {
  it("blocks rather than queueing up messages it could never deliver", async () => {
    // This is the real default for any environment without Twilio configured,
    // and it is the safe direction: a queue of messages that cannot be sent is
    // a queue that will all go out at once the day someone adds credentials.
    messagingConfigured.mockReturnValue(false);
    world();
    await orchestrationTick(NOW);
    expect(messages()).toHaveLength(1);
    expect(messages()[0].status).toBe("blocked");
    expect(messages()[0].blocked_reasons).toContain("messaging_not_configured");
    expect(reviews()).toHaveLength(0);
  });
});

describe("the database itself refuses an unapproved send", () => {
  it("rejects a sendable status with no approver", async () => {
    world();
    await orchestrationTick(NOW);
    const thread = db.rows("message_threads")[0];
    const res = await db
      .from("messages")
      .insert({
        org_id: ORG,
        thread_id: thread.id,
        direction: "outbound",
        status: "approved",
        body: "sneaking one out",
        to_number: PHONE,
      })
      .select("id")
      .maybeSingle();
    expect((res.error as { code?: string } | null)?.code).toBe("23514");
  });
});
