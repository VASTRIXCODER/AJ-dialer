import { describe, expect, it } from "vitest";
import {
  CONSENT_DENIAL_COPY,
  CONSENT_SCOPES,
  consentDenial,
  consentPermits,
  consentSummary,
  isConsentSource,
  UNKNOWN_CONSENT,
  type ConsentSnapshot,
} from "@/lib/consent/state";

const granted = (scope: "transactional" | "promotional"): ConsentSnapshot => ({
  status: "granted",
  scope,
  source: "call_wrapup",
  capturedAt: "2026-08-29T12:00:00.000Z",
});
const revoked: ConsentSnapshot = {
  status: "revoked",
  scope: "transactional",
  source: "inbound_sms",
  capturedAt: "2026-08-29T12:00:00.000Z",
};

describe("silence is not permission", () => {
  it("refuses a promotional send to a number nobody has asked", () => {
    expect(consentPermits(UNKNOWN_CONSENT, "promotional")).toBe(false);
  });

  it("refuses a TRANSACTIONAL send to that number too", () => {
    // Tempting to allow, but the inbound message that would justify a reply
    // records its own transactional grant first — so by the time a reply is
    // composed the state is `granted`, not `unknown`. Leaving unknown
    // permissive would only ever help a send with no inbound behind it.
    expect(consentPermits(UNKNOWN_CONSENT, "transactional")).toBe(false);
  });

  it("treats null and undefined exactly like unknown", () => {
    for (const scope of CONSENT_SCOPES) {
      expect(consentPermits(null, scope)).toBe(false);
      expect(consentPermits(undefined, scope)).toBe(false);
    }
  });

  it("refuses a snapshot that claims granted with no scope", () => {
    // A malformed row must not be read as a yes.
    expect(
      consentPermits({ status: "granted", scope: null, source: "", capturedAt: null }, "transactional"),
    ).toBe(false);
  });
});

describe("the scope ladder only runs one way", () => {
  it("promotional consent covers transactional sends", () => {
    // Someone who opted in to marketing may obviously be sent a confirmation
    // about the appointment they booked.
    expect(consentPermits(granted("promotional"), "transactional")).toBe(true);
    expect(consentPermits(granted("promotional"), "promotional")).toBe(true);
  });

  it("transactional consent does NOT cover marketing", () => {
    expect(consentPermits(granted("transactional"), "transactional")).toBe(true);
    expect(consentPermits(granted("transactional"), "promotional")).toBe(false);
  });

  it("a withdrawal blocks everything, whatever it is scoped to", () => {
    for (const scope of CONSENT_SCOPES) expect(consentPermits(revoked, scope)).toBe(false);
  });
});

describe("the refusal says which refusal it is", () => {
  it("distinguishes never-asked from asked-and-declined", () => {
    // These are different facts about a person and must not collapse: one is a
    // gap in our records, the other is their decision.
    expect(consentDenial(UNKNOWN_CONSENT, "transactional")).toBe("no_consent");
    expect(consentDenial(revoked, "transactional")).toBe("consent_revoked");
  });

  it("names a scope shortfall separately from having no consent at all", () => {
    expect(consentDenial(granted("transactional"), "promotional")).toBe("consent_scope");
  });

  it("returns null when the send is allowed", () => {
    expect(consentDenial(granted("promotional"), "promotional")).toBeNull();
    expect(consentDenial(granted("transactional"), "transactional")).toBeNull();
  });

  it("has operator-facing copy for every reason it can return", () => {
    const reasons = [
      consentDenial(UNKNOWN_CONSENT, "promotional"),
      consentDenial(revoked, "promotional"),
      consentDenial(granted("transactional"), "promotional"),
    ];
    for (const r of reasons) {
      expect(r).not.toBeNull();
      expect(CONSENT_DENIAL_COPY[r!]).toBeTruthy();
      // No schema slugs reach the operator.
      expect(CONSENT_DENIAL_COPY[r!]).not.toMatch(/_/);
    }
  });
});

describe("what a rep reads on the record", () => {
  it("never says 'no consent' for someone nobody asked", () => {
    // A rep who reads "no consent" on an unasked record stops asking.
    const s = consentSummary(UNKNOWN_CONSENT);
    expect(s.label).toBe("Not recorded");
    expect(s.detail.toLowerCase()).toContain("nobody has captured");
    expect(s.tone).toBe("warning");
  });

  it("is unambiguous about a real opt-out", () => {
    const s = consentSummary(revoked);
    expect(s.label).toBe("Opted out");
    expect(s.tone).toBe("danger");
  });

  it("separates full opt-in from replies-only", () => {
    expect(consentSummary(granted("promotional")).label).toBe("Opted in");
    expect(consentSummary(granted("transactional")).label).toBe("Replies only");
  });

  it("handles a missing snapshot without throwing", () => {
    expect(consentSummary(null).label).toBe("Not recorded");
  });
});

describe("sources", () => {
  it("recognises the ones the product writes", () => {
    expect(isConsentSource("inbound_sms")).toBe(true);
    expect(isConsentSource("call_wrapup")).toBe(true);
    expect(isConsentSource("nonsense")).toBe(false);
    expect(isConsentSource(null)).toBe(false);
  });
});
