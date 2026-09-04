import { describe, expect, it } from "vitest";
import { classifyNonConversation, providerDetail } from "@/lib/call-disposition";

// ─────────────────────────────────────────────────────────────────────────────
// Every AI call on the floor was failing with `errorCode: 3000` and the call
// detail modal said only: "The voice provider returned an error for this call.
// No conversation took place; this is a system fault, not a homeowner outcome."
//
// That is unactionable. The provider DOES say why — ElevenLabs puts it in
// metadata.error.reason, which the app already parsed and then dropped on the
// floor: not in the summary, not in the log line. So a floor-wide outage looked
// identical whether the cause was a dead agent id, bad Twilio credentials stored
// in ElevenLabs, or a number the provider can't originate on.
// ─────────────────────────────────────────────────────────────────────────────

describe("providerDetail", () => {
  it("carries the provider's own words through", () => {
    expect(providerDetail("3000", "Twilio credentials rejected")).toBe(
      " Provider said: Twilio credentials rejected · code 3000.",
    );
  });

  it("works with a code alone — the case actually seen in production", () => {
    expect(providerDetail("3000", null)).toBe(" Provider said: code 3000.");
  });

  it("works with a reason alone", () => {
    expect(providerDetail(null, "agent not found")).toBe(" Provider said: agent not found.");
  });

  it("adds NOTHING when the provider said nothing", () => {
    // Guards against a dangling " Provider said:" with no content after it.
    expect(providerDetail(null, null)).toBe("");
    expect(providerDetail("", "   ")).toBe("");
  });
});

describe("the provider_error summary a rep actually reads", () => {
  const classify = (errorCode: string | null, errorReason: string | null = null) =>
    classifyNonConversation({ errorCode, errorReason, durationSec: 0, terminationReason: "" });

  it("names the code instead of stopping at the generic sentence", () => {
    const v = classify("3000");
    expect(v.kind).toBe("failure");
    expect(v.summary).toContain("code 3000");
  });

  it("includes the reason when the provider gives one", () => {
    expect(classify("3000", "twilio auth failed").summary).toContain("twilio auth failed");
  });

  it("keeps the system-fault framing — this is never a homeowner outcome", () => {
    const v = classify("3000");
    expect(v.summary).toContain("system fault");
    // A provider error must stay un-dispositioned so it can't deflate the
    // connect rate as a phantom no-answer.
    expect(v.kind === "failure" && v.failureKind).toBe("provider_error");
  });

  it("still reads cleanly when there is no detail to add", () => {
    // failureKind passed directly by a caller that already knows — no code.
    const v = classifyNonConversation({ failureKind: "provider_error", durationSec: 0 });
    expect(v.summary).not.toContain("Provider said");
    expect(v.summary.endsWith("outcome.")).toBe(true);
  });

  it("does not hijack the out-of-credits verdict", () => {
    // Quota is checked BEFORE the generic error branch: it has a one-click fix
    // and its own much more specific summary, so it must not be flattened into
    // provider_error just because a code came along with it.
    const v = classifyNonConversation({
      errorCode: "3000",
      errorReason: "This request exceeds your quota limit.",
      durationSec: 0,
    });
    expect(v.kind === "failure" && v.failureKind).toBe("provider_quota_exceeded");
  });

  it("leaves other failure kinds' summaries untouched", () => {
    const v = classifyNonConversation({ failureKind: "bridge_join_failed", durationSec: 0 });
    expect(v.summary).not.toContain("Provider said");
  });
});
