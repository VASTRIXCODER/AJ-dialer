import { describe, expect, it } from "vitest";
import {
  STATE_RANK,
  TRANSPORT_TERMINAL,
  canTransition,
  decideTransition,
  isTransportTerminal,
  providerEventFingerprint,
  twilioStatusToState,
  type AttemptState,
} from "@/lib/calls/state-machine";

// Written OUT, not derived from TRANSITIONS — deriving it would make the sweep
// circular. If the module's table drifts from the spec diagram, this fails.
const EXPECTED: Record<AttemptState, AttemptState[]> = {
  queued: ["reserved", "dialing", "canceled"],
  reserved: ["dialing", "queued", "canceled"],
  dialing: [
    "ringing",
    "human_connected",
    "voicemail_connected",
    "busy",
    "declined",
    "no_answer",
    "failed",
    "canceled",
  ],
  ringing: [
    "human_connected",
    "voicemail_connected",
    "busy",
    "declined",
    "no_answer",
    "failed",
    "canceled",
  ],
  human_connected: ["wrap_up", "dispositioned", "completed", "failed"],
  voicemail_connected: ["wrap_up", "dispositioned", "completed"],
  busy: ["wrap_up", "dispositioned", "completed"],
  declined: ["wrap_up", "dispositioned", "completed"],
  no_answer: ["wrap_up", "dispositioned", "completed"],
  failed: ["wrap_up", "dispositioned", "completed"],
  canceled: ["wrap_up", "dispositioned", "completed"],
  wrap_up: ["dispositioned", "completed"],
  dispositioned: ["completed"],
  completed: [],
};

const ALL: AttemptState[] = [
  "queued",
  "reserved",
  "dialing",
  "ringing",
  "human_connected",
  "voicemail_connected",
  "busy",
  "declined",
  "no_answer",
  "failed",
  "canceled",
  "wrap_up",
  "dispositioned",
  "completed",
];

describe("canTransition — exhaustive 14×14 sweep", () => {
  it("matches the literal expectation table for every ordered pair", () => {
    expect(ALL).toHaveLength(14);
    for (const from of ALL) {
      for (const to of ALL) {
        const want = EXPECTED[from].includes(to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(want);
      }
    }
  });
});

describe("STATE_RANK", () => {
  it("is monotonic through the spec's bands", () => {
    expect(STATE_RANK.queued).toBe(0);
    expect(STATE_RANK.reserved).toBe(1);
    expect(STATE_RANK.dialing).toBe(2);
    expect(STATE_RANK.ringing).toBe(3);
    expect(STATE_RANK.human_connected).toBe(4);
    expect(STATE_RANK.voicemail_connected).toBe(4);
    for (const s of ["busy", "declined", "no_answer", "failed", "canceled"] as const) {
      expect(STATE_RANK[s]).toBe(5);
    }
    expect(STATE_RANK.wrap_up).toBe(6);
    expect(STATE_RANK.dispositioned).toBe(7);
    expect(STATE_RANK.completed).toBe(8);
  });
});

describe("decideTransition", () => {
  it("duplicate terminal event is a duplicate, not an apply", () => {
    const d = decideTransition("no_answer", "no_answer");
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("duplicate");
  });

  it("late ringing after human_connected is stale", () => {
    const d = decideTransition("human_connected", "ringing");
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("stale");
  });

  it("late human_connected after no_answer is stale — upgrades only via the reconciler", () => {
    const d = decideTransition("no_answer", "human_connected");
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("stale");
  });

  it("equal-rank siblings are stale in BOTH directions — first CAS wins", () => {
    expect(decideTransition("voicemail_connected", "human_connected").reason).toBe("stale");
    expect(decideTransition("human_connected", "voicemail_connected").reason).toBe("stale");
    expect(decideTransition("busy", "failed").reason).toBe("stale");
    expect(decideTransition("failed", "busy").reason).toBe("stale");
  });

  it("higher rank without a legal edge is invalid", () => {
    const d = decideTransition("queued", "wrap_up");
    expect(d.apply).toBe(false);
    expect(d.reason).toBe("invalid");
  });

  it("legal forward edges apply", () => {
    expect(decideTransition("dialing", "ringing")).toMatchObject({ apply: true, reason: "ok" });
    expect(decideTransition("ringing", "voicemail_connected")).toMatchObject({
      apply: true,
      reason: "ok",
    });
    expect(decideTransition("queued", "canceled")).toMatchObject({ apply: true, reason: "ok" });
    expect(decideTransition("human_connected", "failed")).toMatchObject({
      apply: true,
      reason: "ok",
    });
  });

  it("reservation release (reserved→queued) ranks stale here — it uses canTransition directly", () => {
    expect(canTransition("reserved", "queued")).toBe(true);
    expect(decideTransition("reserved", "queued").reason).toBe("stale");
  });

  it("allowedFrom is exactly the set of legal sources, for a sample of targets", () => {
    const sources = (incoming: AttemptState) =>
      [...decideTransition("queued", incoming).allowedFrom].sort();
    const legal = (incoming: AttemptState) =>
      ALL.filter((s) => EXPECTED[s].includes(incoming)).sort();

    for (const target of [
      "ringing",
      "human_connected",
      "voicemail_connected",
      "no_answer",
      "wrap_up",
      "dispositioned",
      "completed",
      "queued",
    ] as const) {
      expect(sources(target), `allowedFrom(${target})`).toEqual(legal(target));
    }
    // Spot-check two literally, so a bug in the helper above can't hide one.
    expect(sources("ringing")).toEqual(["dialing"]);
    expect(sources("human_connected")).toEqual(["dialing", "ringing"]);
  });
});

describe("transport-terminal set", () => {
  it("contains the five verdicts plus both connected alternates", () => {
    const want: AttemptState[] = [
      "busy",
      "declined",
      "no_answer",
      "failed",
      "canceled",
      "human_connected",
      "voicemail_connected",
    ];
    expect([...TRANSPORT_TERMINAL].sort()).toEqual([...want].sort());
    for (const s of want) expect(isTransportTerminal(s)).toBe(true);
    for (const s of ["queued", "dialing", "ringing", "wrap_up", "completed"] as const) {
      expect(isTransportTerminal(s)).toBe(false);
    }
  });
});

describe("twilioStatusToState", () => {
  it("maps every documented status", () => {
    expect(twilioStatusToState("initiated")).toBe("dialing");
    expect(twilioStatusToState("queued")).toBe("dialing");
    expect(twilioStatusToState("ringing")).toBe("ringing");
    expect(twilioStatusToState("busy")).toBe("busy");
    expect(twilioStatusToState("no-answer")).toBe("no_answer");
    expect(twilioStatusToState("failed")).toBe("failed");
    expect(twilioStatusToState("canceled")).toBe("canceled");
  });

  it("answered legs split on AnsweredBy — machine_* means voicemail", () => {
    expect(twilioStatusToState("in-progress")).toBe("human_connected");
    expect(twilioStatusToState("in-progress", null)).toBe("human_connected");
    expect(twilioStatusToState("in-progress", "human")).toBe("human_connected");
    expect(twilioStatusToState("in-progress", "unknown")).toBe("human_connected");
    expect(twilioStatusToState("answered", "human")).toBe("human_connected");
    expect(twilioStatusToState("in-progress", "machine_start")).toBe("voicemail_connected");
    expect(twilioStatusToState("in-progress", "machine_end_beep")).toBe("voicemail_connected");
    expect(twilioStatusToState("answered", "machine_end_silence")).toBe("voicemail_connected");
  });

  it("completed is a leg ending, not an attempt verdict", () => {
    expect(twilioStatusToState("completed")).toBeNull();
    expect(twilioStatusToState("completed", "human")).toBeNull();
  });

  it("unknown statuses map to nothing", () => {
    expect(twilioStatusToState("weird-new-status")).toBeNull();
    expect(twilioStatusToState("")).toBeNull();
  });
});

describe("providerEventFingerprint", () => {
  it("is stable for identical Twilio deliveries", () => {
    const input = {
      source: "twilio" as const,
      sid: "CA123",
      status: "ringing",
      sequence: "2",
    };
    expect(providerEventFingerprint(input)).toBe("CA123:ringing:2");
    expect(providerEventFingerprint(input)).toBe(providerEventFingerprint({ ...input }));
  });

  it("missing status/sequence collapse to empty segments, keeping the shape stable", () => {
    expect(providerEventFingerprint({ source: "twilio", sid: "CA123" })).toBe("CA123::");
    expect(
      providerEventFingerprint({ source: "twilio", sid: "CA123", status: null, sequence: null }),
    ).toBe("CA123::");
  });

  it("no sid means no fingerprint — never fabricate one", () => {
    expect(providerEventFingerprint({ source: "twilio", status: "ringing" })).toBeNull();
    expect(providerEventFingerprint({ source: "twilio", sid: null })).toBeNull();
  });

  it("ElevenLabs uses its own event id, or nothing", () => {
    expect(providerEventFingerprint({ source: "elevenlabs", eventId: "evt_9" })).toBe("evt_9");
    expect(providerEventFingerprint({ source: "elevenlabs" })).toBeNull();
    expect(providerEventFingerprint({ source: "elevenlabs", eventId: null })).toBeNull();
  });
});
