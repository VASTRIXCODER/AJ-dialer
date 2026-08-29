import { describe, expect, it } from "vitest";
import {
  countSegments,
  isGsm7,
  OPT_OUT_SUFFIX,
  renderTemplate,
  renderValues,
  templateVariables,
  withOptOut,
} from "@/lib/messaging/render";
import {
  canAdvanceStatus,
  isSendable,
  isTerminal,
  messageStatusCopy,
  statusFromProvider,
  statusRank,
  timestampColumnFor,
} from "@/lib/messaging/status";

describe("a template refuses rather than sending a placeholder", () => {
  it("renders when every variable is supplied", () => {
    const r = renderTemplate("Hi {{firstName}}, see you {{appointmentDate}}.", {
      firstName: "Dana",
      appointmentDate: "Tuesday",
    });
    expect(r.ok).toBe(true);
    expect(r.body).toBe("Hi Dana, see you Tuesday.");
    expect(r.unresolved).toEqual([]);
  });

  it("refuses on a missing variable and NAMES it", () => {
    const r = renderTemplate("Hi {{firstName}}, see you {{appointmentDate}}.", {
      firstName: "Dana",
    });
    expect(r.ok).toBe(false);
    expect(r.unresolved).toEqual(["appointmentDate"]);
    // No body at all, so a caller ignoring `ok` has nothing to send.
    expect(r.body).toBe("");
  });

  it("treats an empty string as missing, not as supplied", () => {
    // This is the case that produces "Hi ," — absent data wearing the costume
    // of present data.
    const r = renderTemplate("Hi {{firstName}},", { firstName: "   " });
    expect(r.ok).toBe(false);
    expect(r.unresolved).toEqual(["firstName"]);
  });

  it("accepts a number, because zero is a real value", () => {
    const r = renderTemplate("You have {{count}} waiting.", { count: 0 });
    expect(r.ok).toBe(true);
    expect(r.body).toBe("You have 0 waiting.");
  });

  it("reports every missing variable, not just the first", () => {
    const r = renderTemplate("{{a}} {{b}} {{c}}", { b: "x" });
    expect(r.unresolved).toEqual(["a", "c"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("Hi {{ firstName }}", { firstName: "Dana" }).body).toBe("Hi Dana");
  });

  it("lists a template's variables in first-appearance order", () => {
    expect(templateVariables("{{b}} {{a}} {{b}}")).toEqual(["b", "a"]);
    expect(templateVariables("no variables here")).toEqual([]);
  });

  it("exposes only an explicit, small set of values", () => {
    // A renderer that could reach any column would let an author put a lead's
    // internal notes into a customer's message by typing a field name.
    const keys = Object.keys(renderValues({ firstName: "Dana" }));
    expect(keys).not.toContain("notes");
    expect(keys).not.toContain("phone");
    expect(keys).toContain("firstName");
  });
});

describe("every message carries a way out", () => {
  it("appends the opt-out line", () => {
    expect(withOptOut("Your appointment is confirmed.")).toContain(OPT_OUT_SUFFIX);
  });

  it("does not repeat it when the author already said it", () => {
    const body = "Confirmed. Reply STOP to unsubscribe.";
    expect(withOptOut(body)).toBe(body);
  });
});

describe("segment counting reflects what the carrier charges", () => {
  it("counts a short plain message as one", () => {
    expect(countSegments("Hello there.")).toBe(1);
    expect(countSegments("")).toBe(0);
  });

  it("splits GSM-7 at 160, then at 153", () => {
    expect(countSegments("a".repeat(160))).toBe(1);
    expect(countSegments("a".repeat(161))).toBe(2);
    expect(countSegments("a".repeat(306))).toBe(2);
    expect(countSegments("a".repeat(307))).toBe(3);
  });

  it("one non-GSM character nearly halves the capacity", () => {
    // A curly apostrophe pasted in from a document is the usual culprit, and
    // it silently doubles the cost of a long message.
    const curly = "’";
    expect(isGsm7(curly)).toBe(false);
    expect(countSegments("a".repeat(80))).toBe(1);
    expect(countSegments("a".repeat(80) + curly)).toBe(2);
  });

  it("counts an emoji as the surrogate pair the carrier sees", () => {
    // Each of these is TWO UTF-16 code units, so 35 of them is exactly the
    // 70-unit UCS-2 limit and 36 spills into a second segment. Counting them
    // as one character each would under-report the cost by half.
    expect(countSegments("\u{1F44D}".repeat(35))).toBe(1);
    expect(countSegments("\u{1F44D}".repeat(36))).toBe(2);
  });
});

describe("the status ladder is monotonic", () => {
  it("advances forward", () => {
    expect(canAdvanceStatus("queued", "sending")).toBe(true);
    expect(canAdvanceStatus("sent", "delivered")).toBe(true);
  });

  it("REFUSES a late receipt that would demote a delivered message", () => {
    // Twilio does not guarantee ordering, so a `sent` receipt genuinely does
    // arrive after `delivered`. It must be a no-op, not a downgrade.
    expect(canAdvanceStatus("delivered", "sent")).toBe(false);
    expect(canAdvanceStatus("delivered", "queued")).toBe(false);
  });

  it("never lets a stray callback resurrect something a human refused", () => {
    expect(canAdvanceStatus("rejected", "sending")).toBe(false);
    expect(canAdvanceStatus("canceled", "delivered")).toBe(false);
  });

  it("ranks delivered above every other terminal state", () => {
    expect(statusRank("delivered")).toBeGreaterThan(statusRank("sent"));
    expect(statusRank("delivered")).toBeGreaterThan(statusRank("undelivered"));
    expect(statusRank("delivered")).toBeGreaterThan(statusRank("failed"));
  });

  it("rejects an unknown status rather than guessing", () => {
    expect(canAdvanceStatus("queued", "nonsense")).toBe(false);
    expect(statusRank("nonsense")).toBe(-1);
  });
});

describe("the provider's words are not our words", () => {
  it("maps Twilio's accept to queued, NEVER to sent", () => {
    // create() returning means "we have it", not "they got it".
    expect(statusFromProvider("accepted")).toBe("queued");
    expect(statusFromProvider("queued")).toBe("queued");
  });

  it("maps the real delivery outcomes", () => {
    expect(statusFromProvider("sent")).toBe("sent");
    expect(statusFromProvider("delivered")).toBe("delivered");
    expect(statusFromProvider("undelivered")).toBe("undelivered");
    expect(statusFromProvider("failed")).toBe("failed");
  });

  it("is case-insensitive and ignores anything it does not know", () => {
    expect(statusFromProvider("DELIVERED")).toBe("delivered");
    expect(statusFromProvider("something_new")).toBeNull();
  });

  it("writes each timestamp from the status that earns it", () => {
    expect(timestampColumnFor("sent")).toBe("sent_at");
    expect(timestampColumnFor("delivered")).toBe("delivered_at");
    expect(timestampColumnFor("queued")).toBe("queued_at");
    expect(timestampColumnFor("sending")).toBeNull();
  });
});

describe("what the operator reads", () => {
  it("says out loud that `sent` is often as far as it goes", () => {
    // Without this, every message on a route that never confirms delivery
    // looks half-broken forever.
    const copy = messageStatusCopy("sent");
    expect(copy.tone).toBe("success");
    expect(copy.detail.toLowerCase()).toContain("never confirm");
  });

  it("frames a blocked message as protection, not breakage", () => {
    const copy = messageStatusCopy("blocked");
    expect(copy.tone).not.toBe("danger");
    expect(copy.detail.toLowerCase()).toContain("stopped before sending");
  });

  it("has copy for every status without a raw schema word", () => {
    for (const s of [
      "draft",
      "needs_approval",
      "approved",
      "queued",
      "sending",
      "sent",
      "delivered",
      "undelivered",
      "failed",
      "blocked",
      "rejected",
      "canceled",
      "needs_review",
      "received",
    ]) {
      const copy = messageStatusCopy(s);
      expect(copy.label).toBeTruthy();
      expect(copy.label).not.toMatch(/_/);
    }
  });
});

describe("what the drain may touch", () => {
  it("picks up only approved and queued", () => {
    expect(isSendable("approved")).toBe(true);
    expect(isSendable("queued")).toBe(true);
    expect(isSendable("needs_approval")).toBe(false);
    expect(isSendable("sent")).toBe(false);
  });

  it("knows which states are finished", () => {
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("blocked")).toBe(true);
    expect(isTerminal("sending")).toBe(false);
  });
});
