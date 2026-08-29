import { describe, expect, it } from "vitest";
import {
  ARTIFACT_KINDS,
  artifactEvidence,
  artifactPayload,
  buildAnalysisSchema,
  parseAnalysis,
  sanitizeEvidence,
  type CallAnalysis,
} from "@/lib/ai/schemas";

/** A well-formed model payload over a 6-turn transcript. */
function golden(): Record<string, unknown> {
  return {
    summary: {
      confidence: 0.9,
      text: "Spoke with the contact; they asked for numbers before booking.",
      keyPoints: ["Asked for concrete numbers", "Open to a follow-up"],
    },
    facts: {
      confidence: 0.85,
      items: [
        { label: "Decision maker", value: "Yes", evidence: [1, 3] },
        { label: "Current provider", value: "Acme", evidence: [2] },
      ],
    },
    objections: {
      confidence: 0.7,
      items: [
        { objection: "Is this a scam?", response: "Explained the company", evidence: [1] },
        { objection: "Too busy this week", response: "", evidence: [4] },
      ],
    },
    commitments: {
      confidence: 0.8,
      items: [
        { who: "agent", what: "Send the numbers by email", when: "today", evidence: [5] },
        { who: "contact", what: "Review before Friday", when: "", evidence: [5] },
      ],
    },
    appointment_signals: {
      confidence: 0.6,
      present: false,
      when: "",
      evidence: [],
    },
    compliance_flags: { confidence: 0.95, items: [] },
    proposed_disposition: {
      confidence: 0.82,
      key: "callback_scheduled",
      outcome: "callback_scheduled",
      rationale: "They asked to be called after reviewing the numbers.",
      evidence: [4, 5],
    },
  };
}

describe("buildAnalysisSchema", () => {
  it("covers every artifact kind and forbids extras (structured-output safe)", () => {
    const schema = buildAnalysisSchema() as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties).sort()).toEqual([...ARTIFACT_KINDS].sort());
    expect(schema.required.sort()).toEqual([...ARTIFACT_KINDS].sort());
    expect(schema.additionalProperties).toBe(false);
    // The contract with claude.ts: the schema itself never carries a `name`
    // (output_config.format takes exactly {type, schema}).
    expect("name" in schema).toBe(false);
  });
});

describe("parseAnalysis — golden path", () => {
  it("accepts a well-formed payload and preserves its content", () => {
    const out = parseAnalysis(golden(), 6);
    expect(out).not.toBeNull();
    const a = out as CallAnalysis;
    expect(a.summary.text).toMatch(/asked for numbers/);
    expect(a.summary.keyPoints).toHaveLength(2);
    expect(a.facts.items).toHaveLength(2);
    expect(a.proposed_disposition.key).toBe("callback_scheduled");
    expect(a.proposed_disposition.confidence).toBe(0.82);
  });

  it('maps "" optionals back to undefined (the schema requires every field)', () => {
    const a = parseAnalysis(golden(), 6)!;
    expect(a.objections.items[1].response).toBeUndefined();
    expect(a.commitments.items[1].when).toBeUndefined();
    expect(a.appointment_signals.when).toBeUndefined();
    // Non-empty optionals survive.
    expect(a.objections.items[0].response).toBe("Explained the company");
    expect(a.commitments.items[0].when).toBe("today");
  });

  it("clamps confidence into [0, 1] instead of persisting an impossible number", () => {
    const raw = golden();
    (raw.summary as Record<string, unknown>).confidence = 87; // "87%" drift
    (raw.facts as Record<string, unknown>).confidence = -2;
    const a = parseAnalysis(raw, 6)!;
    expect(a.summary.confidence).toBe(1);
    expect(a.facts.confidence).toBe(0);
  });
});

describe("parseAnalysis — shape drift rejects to null (never throws)", () => {
  it("rejects non-objects", () => {
    expect(parseAnalysis(null, 6)).toBeNull();
    expect(parseAnalysis("summary", 6)).toBeNull();
    expect(parseAnalysis([golden()], 6)).toBeNull();
  });

  it("rejects a missing kind", () => {
    const raw = golden();
    delete raw.compliance_flags;
    expect(parseAnalysis(raw, 6)).toBeNull();
  });

  it("rejects a kind whose items container is not an array", () => {
    const raw = golden();
    (raw.facts as Record<string, unknown>).items = { label: "x" };
    expect(parseAnalysis(raw, 6)).toBeNull();
  });

  it("rejects a missing/non-numeric confidence", () => {
    const raw = golden();
    delete (raw.summary as Record<string, unknown>).confidence;
    expect(parseAnalysis(raw, 6)).toBeNull();
    const raw2 = golden();
    (raw2.objections as Record<string, unknown>).confidence = "high";
    expect(parseAnalysis(raw2, 6)).toBeNull();
  });

  it("rejects a proposed disposition outside the canonical key set", () => {
    const raw = golden();
    (raw.proposed_disposition as Record<string, unknown>).key = "left_with_spouse";
    expect(parseAnalysis(raw, 6)).toBeNull();
    const raw2 = golden();
    (raw2.proposed_disposition as Record<string, unknown>).outcome = "maybe_later";
    expect(parseAnalysis(raw2, 6)).toBeNull();
  });

  it("rejects a non-boolean appointment_signals.present", () => {
    const raw = golden();
    (raw.appointment_signals as Record<string, unknown>).present = "yes";
    expect(parseAnalysis(raw, 6)).toBeNull();
  });

  it("drops malformed list ITEMS without losing the whole analysis", () => {
    const raw = golden();
    (raw.facts as { items: unknown[] }).items.push(
      { label: 42, value: "no label", evidence: [] },
      "not an object",
      { label: "  ", value: "blank label", evidence: [] },
    );
    const a = parseAnalysis(raw, 6)!;
    expect(a.facts.items).toHaveLength(2);
  });
});

describe("evidence bounds vs turn count", () => {
  it("drops indices past the transcript and non-integers, dedupes and sorts", () => {
    expect(sanitizeEvidence([2, 0, 99, -1, 2.5, "3", 2], 6)).toEqual([0, 2, 3]);
  });

  it("treats a missing evidence field as empty but a wrong TYPE as drift", () => {
    expect(sanitizeEvidence(undefined, 6)).toEqual([]);
    expect(sanitizeEvidence("0,1", 6)).toBeNull();
  });

  it("bounds item evidence against the turn count end-to-end", () => {
    const raw = golden();
    (raw.facts as { items: { evidence: number[] }[] }).items[0].evidence = [1, 3, 40];
    const a = parseAnalysis(raw, 6)!;
    expect(a.facts.items[0].evidence).toEqual([1, 3]);
  });

  it("without a turn count (no transcript) keeps only non-negative integers", () => {
    const raw = golden();
    (raw.proposed_disposition as Record<string, unknown>).evidence = [7, -2, 1.5];
    const a = parseAnalysis(raw, undefined)!;
    expect(a.proposed_disposition.evidence).toEqual([7]);
  });
});

describe("artifact row helpers", () => {
  it("artifactEvidence unions item evidence for list kinds and [] for summary", () => {
    const a = parseAnalysis(golden(), 6)!;
    expect(artifactEvidence("summary", a)).toEqual([]);
    expect(artifactEvidence("facts", a)).toEqual([1, 2, 3]);
    expect(artifactEvidence("proposed_disposition", a)).toEqual([4, 5]);
  });

  it("artifactPayload carries the kind's own confidence for the row column", () => {
    const a = parseAnalysis(golden(), 6)!;
    const { payload, confidence } = artifactPayload("objections", a);
    expect(confidence).toBe(0.7);
    expect((payload as { items: unknown[] }).items).toHaveLength(2);
  });
});
