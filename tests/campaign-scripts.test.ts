import { describe, expect, it } from "vitest";
import {
  isScriptTestRunning,
  scriptTextForVariant,
  scriptVariantForLead,
} from "@/lib/campaign-scripts";

const lead = (id: string) => ({ id });

describe("scriptVariantForLead", () => {
  it("returns null when the campaign has no scripts", () => {
    expect(scriptVariantForLead(lead("x"), { scriptA: "", scriptB: "" })).toBeNull();
    expect(scriptVariantForLead(lead("x"), null)).toBeNull();
    expect(scriptVariantForLead(lead("x"), undefined)).toBeNull();
  });

  it("treats whitespace-only scripts as unset", () => {
    expect(scriptVariantForLead(lead("x"), { scriptA: "  \n ", scriptB: "" })).toBeNull();
    expect(scriptVariantForLead(lead("x"), { scriptA: " \t", scriptB: "Hi" })).toBe("b");
  });

  it("returns 'a' when only script A is set", () => {
    const c = { scriptA: "Hi there", scriptB: "" };
    expect(scriptVariantForLead(lead("lead-1"), c)).toBe("a");
    expect(scriptVariantForLead(lead("lead-2"), c)).toBe("a");
  });

  it("returns 'b' when only script B is set", () => {
    const c = { scriptA: "", scriptB: "Hello" };
    expect(scriptVariantForLead(lead("lead-1"), c)).toBe("b");
  });

  it("is deterministic per lead when both scripts are set", () => {
    const c = { scriptA: "Opener A", scriptB: "Opener B" };
    for (const id of ["a1", "b2", "c3", "550e8400-e29b-41d4-a716-446655440000"]) {
      const first = scriptVariantForLead(lead(id), c);
      expect(first === "a" || first === "b").toBe(true);
      // The same lead gets the same script on every attempt.
      expect(scriptVariantForLead(lead(id), c)).toBe(first);
    }
  });

  it("actually splits a population across both variants", () => {
    const c = { scriptA: "A", scriptB: "B" };
    const seen = new Set(
      Array.from({ length: 50 }, (_, i) => scriptVariantForLead(lead(`lead-${i}`), c)),
    );
    expect(seen.has("a")).toBe(true);
    expect(seen.has("b")).toBe(true);
  });
});

describe("scriptTextForVariant", () => {
  const c = { scriptA: "  Alpha script  ", scriptB: "Beta script" };

  it("returns the assigned variant's trimmed text", () => {
    expect(scriptTextForVariant(c, "a")).toBe("Alpha script");
    expect(scriptTextForVariant(c, "b")).toBe("Beta script");
  });

  it("returns '' for a null variant", () => {
    expect(scriptTextForVariant(c, null)).toBe("");
  });
});

describe("isScriptTestRunning", () => {
  it("requires BOTH scripts to be non-empty", () => {
    expect(isScriptTestRunning({ scriptA: "A", scriptB: "B" })).toBe(true);
    expect(isScriptTestRunning({ scriptA: "A", scriptB: "" })).toBe(false);
    expect(isScriptTestRunning({ scriptA: "", scriptB: "B" })).toBe(false);
    expect(isScriptTestRunning({ scriptA: "", scriptB: "" })).toBe(false);
    expect(isScriptTestRunning({ scriptA: "A", scriptB: "  " })).toBe(false);
  });
});
