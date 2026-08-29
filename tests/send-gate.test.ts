import { describe, expect, it } from "vitest";
import type { ConsentSnapshot } from "@/lib/consent/state";
import {
  DEFAULT_QUIET_HOURS,
  SEND_DENIAL_COPY,
  evaluateSendGate,
  isDeferrable,
  nextQuietHoursOpening,
  primaryDenial,
  withinQuietHours,
  type SendDenial,
  type SendGateInput,
} from "@/lib/messaging/send-gate";

const consented: ConsentSnapshot = {
  status: "granted",
  scope: "promotional",
  source: "call_wrapup",
  capturedAt: "2026-08-01T12:00:00.000Z",
};

// 2026-08-29 17:00Z = 12:00 in Chicago, 10:00 Pacific, 13:00 Eastern.
// Comfortably inside 9–20 everywhere in the continental US.
const NOON_CENTRAL = new Date("2026-08-29T17:00:00.000Z");

function input(over: Partial<SendGateInput> = {}): SendGateInput {
  return {
    now: NOON_CENTRAL,
    toPhone: "+13125550143",
    senderNumber: "+13125559999",
    body: "Confirming your appointment tomorrow at 2pm.",
    isDnc: false,
    consent: consented,
    requiredScope: "transactional",
    candidateTimezones: ["America/Chicago"],
    quietHours: DEFAULT_QUIET_HOURS,
    contactSentToday: 0,
    contactSentThisWeek: 0,
    orgSentToday: 0,
    caps: { perContactPerDay: 2, perContactPer7Days: 5, perOrgPerDay: 500 },
    messagingConfigured: true,
    orgMessagingEnabled: true,
    messagingPaused: false,
    templateRequired: false,
    templatePublished: true,
    unresolvedVariables: [],
    approvedBy: "user-a",
    ...over,
  };
}

describe("the happy path", () => {
  it("lets an approved, consented, in-hours message go", () => {
    const v = evaluateSendGate(input());
    expect(v.allowed).toBe(true);
    expect(v.denials).toEqual([]);
    expect(v.deferUntil).toBeNull();
  });
});

describe("it reports EVERY reason, not the first", () => {
  it("names all of them at once", () => {
    // The whole point: "why can't I text this person" has a complete answer,
    // and revealing one blocker per round trip turns fixing a record into a
    // guessing game.
    const v = evaluateSendGate(
      input({
        isDnc: true,
        consent: null,
        senderNumber: null,
        approvedBy: null,
        messagingConfigured: false,
      }),
    );
    expect(v.allowed).toBe(false);
    expect(v.denials).toEqual(
      expect.arrayContaining([
        "dnc",
        "no_consent",
        "no_sender",
        "needs_human_approval",
        "messaging_not_configured",
      ]),
    );
    expect(v.denials.length).toBeGreaterThanOrEqual(5);
  });

  it("leads with compliance, never with the approval queue", () => {
    const v = evaluateSendGate(input({ isDnc: true, approvedBy: null }));
    expect(primaryDenial(v.denials)).toBe("dnc");
  });

  it("has operator copy for every denial it can emit, with no schema words", () => {
    const all = Object.keys(SEND_DENIAL_COPY) as SendDenial[];
    for (const d of all) {
      expect(SEND_DENIAL_COPY[d]).toBeTruthy();
      expect(SEND_DENIAL_COPY[d]).not.toMatch(/_/);
    }
    expect(primaryDenial([])).toBeNull();
  });
});

describe("nothing sendable without a named human", () => {
  it("refuses a message nobody approved", () => {
    const v = evaluateSendGate(input({ approvedBy: null }));
    expect(v.allowed).toBe(false);
    expect(v.denials).toContain("needs_human_approval");
  });

  it("does not treat waiting for approval as deferrable", () => {
    // A hold is something time fixes. A human deciding is not.
    expect(isDeferrable("needs_human_approval")).toBe(false);
    const v = evaluateSendGate(input({ approvedBy: null }));
    expect(v.deferUntil).toBeNull();
  });
});

describe("consent and DNC both gate, and neither substitutes", () => {
  it("refuses a suppressed number even with full consent", () => {
    const v = evaluateSendGate(input({ isDnc: true }));
    expect(v.denials).toContain("dnc");
    expect(v.allowed).toBe(false);
  });

  it("refuses a clean number with no recorded consent", () => {
    const v = evaluateSendGate(input({ consent: null, isDnc: false }));
    expect(v.denials).toContain("no_consent");
  });

  it("refuses marketing to someone who only agreed to replies", () => {
    const v = evaluateSendGate(
      input({
        consent: { status: "granted", scope: "transactional", source: "inbound_sms", capturedAt: null },
        requiredScope: "promotional",
      }),
    );
    expect(v.denials).toContain("consent_scope");
  });

  it("never offers to retry a compliance refusal later", () => {
    // Waiting does not make an opt-out acceptable.
    const v = evaluateSendGate(input({ isDnc: true, contactSentToday: 99 }));
    expect(v.deferUntil).toBeNull();
  });
});

describe("quiet hours bracket across disagreeing timezones", () => {
  // 2026-08-30 01:30Z = 8:30pm Eastern, 5:30pm Pacific.
  const EVENING = new Date("2026-08-30T01:30:00.000Z");

  it("allows the send when the only zone is comfortably open", () => {
    expect(withinQuietHours(EVENING, DEFAULT_QUIET_HOURS, ["America/Los_Angeles"])).toBe(true);
  });

  it("refuses when ANY candidate zone has closed", () => {
    // Same instant is 8:30pm in New York — past the 8pm close. A record whose
    // stored zone says Pacific but whose area code says Eastern must be treated
    // as the one already asleep.
    expect(
      withinQuietHours(EVENING, DEFAULT_QUIET_HOURS, [
        "America/Los_Angeles",
        "America/New_York",
      ]),
    ).toBe(false);
  });

  it("refuses when we cannot name a timezone at all", () => {
    // We do not send into a zone we cannot identify.
    expect(withinQuietHours(EVENING, DEFAULT_QUIET_HOURS, [])).toBe(false);
  });

  it("skips the check entirely only when quiet hours are unset", () => {
    expect(withinQuietHours(EVENING, null, [])).toBe(true);
  });

  it("holds rather than refuses, and says when to come back", () => {
    const v = evaluateSendGate(
      input({ now: EVENING, candidateTimezones: ["America/New_York"] }),
    );
    expect(v.allowed).toBe(false);
    expect(v.denials).toEqual(["quiet_hours"]);
    expect(v.deferUntil).toBeInstanceOf(Date);
    // Next morning, not "in an hour".
    expect(v.deferUntil!.getTime()).toBeGreaterThan(EVENING.getTime());
    expect(withinQuietHours(v.deferUntil!, DEFAULT_QUIET_HOURS, ["America/New_York"])).toBe(true);
  });

  it("returns the current instant when already open", () => {
    expect(
      nextQuietHoursOpening(NOON_CENTRAL, DEFAULT_QUIET_HOURS, ["America/Chicago"]),
    ).toBe(NOON_CENTRAL);
  });

  it("defaults tighter than the statute, on purpose", () => {
    // The imported book's timezones are unreliable at exactly the boundary,
    // and an hour of margin at each end absorbs that error.
    expect(DEFAULT_QUIET_HOURS.startHour).toBeGreaterThan(8);
    expect(DEFAULT_QUIET_HOURS.endHour).toBeLessThan(21);
  });
});

describe("frequency caps defer, they do not cancel", () => {
  it("holds at the per-contact daily cap and comes back when it clears", () => {
    const clears = new Date(NOON_CENTRAL.getTime() + 6 * 3_600_000);
    const v = evaluateSendGate(
      input({ contactSentToday: 2, contactDayWindowClearsAt: clears }),
    );
    expect(v.denials).toEqual(["cap_contact_day"]);
    expect(v.deferUntil?.toISOString()).toBe(clears.toISOString());
  });

  it("waits for the LAST of several holds, not the first", () => {
    const dayClears = new Date(NOON_CENTRAL.getTime() + 2 * 3_600_000);
    const weekClears = new Date(NOON_CENTRAL.getTime() + 40 * 3_600_000);
    const v = evaluateSendGate(
      input({
        contactSentToday: 2,
        contactSentThisWeek: 5,
        contactDayWindowClearsAt: dayClears,
        contactWeekWindowClearsAt: weekClears,
      }),
    );
    expect(v.denials).toEqual(["cap_contact_day", "cap_contact_week"]);
    expect(v.deferUntil?.toISOString()).toBe(weekClears.toISOString());
  });

  it("holds the whole workspace at its daily ceiling", () => {
    const v = evaluateSendGate(input({ orgSentToday: 500 }));
    expect(v.denials).toEqual(["cap_org_day"]);
    expect(v.deferUntil).toBeInstanceOf(Date);
  });

  it("treats a cap of zero as no cap, not as a cap of nothing", () => {
    const v = evaluateSendGate(
      input({
        contactSentToday: 99,
        contactSentThisWeek: 99,
        orgSentToday: 99_999,
        caps: { perContactPerDay: 0, perContactPer7Days: 0, perOrgPerDay: 0 },
      }),
    );
    expect(v.allowed).toBe(true);
  });
});

describe("configuration refusals", () => {
  it("refuses an unpublished template", () => {
    const v = evaluateSendGate(input({ templateRequired: true, templatePublished: false }));
    expect(v.denials).toContain("template_not_published");
  });

  it("refuses a body with an unfilled placeholder", () => {
    // "Hi {{firstName}}" must never be something a human is asked to approve.
    const v = evaluateSendGate(input({ unresolvedVariables: ["firstName"] }));
    expect(v.denials).toContain("unresolved_variables");
    expect(v.deferUntil).toBeNull();
  });

  it("refuses when messaging is paused platform-wide", () => {
    const v = evaluateSendGate(input({ messagingPaused: true }));
    expect(v.denials).toContain("messaging_paused");
  });

  it("refuses when the workspace has messaging off", () => {
    const v = evaluateSendGate(input({ orgMessagingEnabled: false }));
    expect(v.denials).toContain("org_messaging_off");
  });

  it("refuses an empty body", () => {
    expect(evaluateSendGate(input({ body: "   " })).denials).toContain("empty_body");
  });
});
