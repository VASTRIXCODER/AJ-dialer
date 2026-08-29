import { describe, expect, it } from "vitest";
import { validateDefinition } from "@/lib/orchestration/definition";

// ─────────────────────────────────────────────────────────────────────────────
// The extra bar a playbook clears before it may message a customer.
//
// A task that turns out to be unnecessary wastes a rep's minute. A message that
// turns out to be unnecessary lands on a stranger's phone and cannot be
// recalled. So these are refusals at publish, not warnings in a sidebar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Overrides are intentionally untyped. Half of these cases construct shapes the
 * type system forbids on purpose — an unknown step kind, a scope that isn't one
 * — because that is exactly what a publish validator exists to catch, and a
 * validator test that can only express valid input tests nothing.
 */
function playbook(over: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    key: "no_show_recovery",
    name: "No-show recovery",
    trigger: { kind: "event", event: "call.completed" },
    steps: [
      { id: "reach_out", kind: "send_message", templateKey: "no_show_first_touch" },
      { id: "grace", kind: "wait", for: { hours: 4 } },
      {
        id: "task",
        kind: "create_work_item",
        type: "follow_up_call",
        reason: "no_show_recovery",
      },
    ],
    stop: {
      rules: ["replied", "contacted", "appointment_booked", "dnc_or_opt_out"],
    },
    caps: { touchesPerDay: 1 },
    ...over,
  };
}

const errorsOf = (def: unknown) => validateDefinition(def).errors.join(" ");

describe("a messaging playbook that meets the bar", () => {
  it("publishes", () => {
    const v = validateDefinition(playbook());
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("accepts an explicit scope", () => {
    expect(
      validateDefinition(
        playbook({
          steps: [
            {
              id: "offer",
              kind: "send_message",
              templateKey: "reactivation_offer",
              scope: "promotional",
            },
          ],
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("it must be silenceable by a reply", () => {
  it("refuses without the `replied` stop rule", () => {
    const errs = errorsOf(
      playbook({
        stop: { rules: ["contacted", "dnc_or_opt_out"] },
      }),
    );
    // Otherwise the sequence keeps texting someone who is already answering.
    expect(errs).toContain('stop.rules must include "replied"');
  });

  it("says WHY, not just that it refused", () => {
    const errs = errorsOf(
      playbook({ stop: { rules: ["contacted"] } }),
    );
    expect(errs).toContain("already talking to you");
  });
});

describe("it must say how often", () => {
  it("refuses without a daily touch cap", () => {
    expect(errorsOf(playbook({ caps: undefined }))).toContain("caps.touchesPerDay must be set");
  });

  it("refuses a cap of zero, which is not a cap", () => {
    expect(errorsOf(playbook({ caps: { touchesPerDay: 0 } }))).toContain(
      "caps.touchesPerDay must be set",
    );
  });

  it("states that there is no safe default", () => {
    expect(errorsOf(playbook({ caps: undefined }))).toContain("no safe default");
  });
});

describe("it may not ride the capped intake trigger", () => {
  it("refuses a lead.received trigger", () => {
    // processLeadIntake emits at most 50 per run against ~1,400 new leads a
    // day, so only an arbitrary subset would ever be messaged. Tolerable when
    // the output is an internal task; not when it is a text message.
    const errs = errorsOf(
      playbook({ trigger: { kind: "event", event: "lead.received" } }),
    );
    expect(errs).toContain("capped subset");
  });

  it("allows the same trigger when nothing is being sent", () => {
    const v = validateDefinition(
      playbook({
        trigger: { kind: "event", event: "lead.received" },
        steps: [
          { id: "t", kind: "create_work_item", type: "first_call", reason: "speed_to_lead" },
        ],
        stop: { rules: ["attempted"] },
        caps: undefined,
      }),
    );
    expect(v.ok).toBe(true);
  });
});

describe("nothing runs while a proposal is still waiting for a human", () => {
  it("refuses a step immediately after a send_message", () => {
    const errs = errorsOf(
      playbook({
        steps: [
          { id: "msg", kind: "send_message", templateKey: "no_show_first_touch" },
          { id: "task", kind: "create_work_item", type: "follow_up_call", reason: "x" },
        ],
      }),
    );
    expect(errs).toContain("followed by a wait");
  });

  it("allows a send_message as the last step", () => {
    expect(
      validateDefinition(
        playbook({
          steps: [{ id: "msg", kind: "send_message", templateKey: "no_show_first_touch" }],
        }),
      ).ok,
    ).toBe(true);
  });

  it("allows a stop straight after one", () => {
    expect(
      validateDefinition(
        playbook({
          steps: [
            { id: "msg", kind: "send_message", templateKey: "no_show_first_touch" },
            { id: "done", kind: "stop" },
          ],
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("the step's own shape", () => {
  it("requires a template key", () => {
    expect(
      errorsOf(playbook({ steps: [{ id: "msg", kind: "send_message" }] })),
    ).toContain("templateKey must be a slug");
  });

  it("refuses an unknown scope", () => {
    expect(
      errorsOf(
        playbook({
          steps: [
            { id: "msg", kind: "send_message", templateKey: "t", scope: "whatever" },
          ],
        }),
      ),
    ).toContain("scope must be");
  });
});

describe("the old reserved kinds point somewhere useful", () => {
  it("redirects send_sms to the kind that exists", () => {
    const errs = errorsOf(
      playbook({
        steps: [{ id: "msg", kind: "send_sms", templateKey: "t" }],
      }),
    );
    expect(errs).toContain('Use "send_message" instead');
  });

  it("redirects send_email the same way", () => {
    expect(
      errorsOf(
        playbook({
          steps: [{ id: "msg", kind: "send_email" }],
        }),
      ),
    ).toContain('Use "send_message" instead');
  });

  it("leaves the other reserved kinds refused without a redirect", () => {
    const errs = errorsOf(
      playbook({
        steps: [{ id: "b", kind: "branch" }],
      }),
    );
    expect(errs).toContain("is reserved");
    expect(errs).not.toContain('Use "send_message" instead');
  });
});
