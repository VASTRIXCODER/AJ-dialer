import { describe, expect, it } from "vitest";
import { dedupeLeadsByPhone } from "@/lib/dialer/lane-dedupe";

// ─────────────────────────────────────────────────────────────────────────────
// The parallel round's phone-duplicate guard. The reservation engine prevents
// the same LEAD landing on two lanes; this guard prevents the same NUMBER —
// two different lead rows sharing one phone (re-imports, shared landlines)
// would otherwise ring one phone on two lanes simultaneously.
// ─────────────────────────────────────────────────────────────────────────────

const lead = (id: string, phone: string) => ({ id, phone });

describe("dedupeLeadsByPhone", () => {
  it("leaves a round of distinct numbers untouched, in order", () => {
    const round = [
      lead("a", "+15551230001"),
      lead("b", "+15551230002"),
      lead("c", "+15551230003"),
    ];
    const { kept, dropped } = dedupeLeadsByPhone(round);
    expect(kept.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(dropped).toEqual([]);
  });

  it("drops the LATER occurrence of a duplicated number, keeps the first", () => {
    const { kept, dropped } = dedupeLeadsByPhone([
      lead("first", "+15551230001"),
      lead("other", "+15551230002"),
      lead("dupe", "+15551230001"),
    ]);
    expect(kept.map((l) => l.id)).toEqual(["first", "other"]);
    expect(dropped.map((l) => l.id)).toEqual(["dupe"]);
  });

  it("normalizes before comparing — formatting variants of one number collide", () => {
    const { kept, dropped } = dedupeLeadsByPhone([
      lead("e164", "+15551234567"),
      lead("pretty", "(555) 123-4567"),
      lead("dashed", "1-555-123-4567"),
    ]);
    expect(kept.map((l) => l.id)).toEqual(["e164"]);
    expect(dropped.map((l) => l.id)).toEqual(["pretty", "dashed"]);
  });

  it("a number appearing three times keeps exactly one lane", () => {
    const { kept, dropped } = dedupeLeadsByPhone([
      lead("one", "5551230009"),
      lead("two", "5551230009"),
      lead("three", "+15551230009"),
    ]);
    expect(kept.map((l) => l.id)).toEqual(["one"]);
    expect(dropped.map((l) => l.id)).toEqual(["two", "three"]);
  });

  it("does NOT treat unparseable phones as duplicates of each other", () => {
    // Both normalize to "" — but "" is not a phone number, and dropping the
    // second junk row as a 'duplicate' would silently eat a lead. Validity is
    // another guard's job (queue/import filters, the Twilio route).
    const { kept, dropped } = dedupeLeadsByPhone([
      lead("junk1", "N/A"),
      lead("junk2", ""),
      lead("real", "+15551230004"),
    ]);
    expect(kept.map((l) => l.id)).toEqual(["junk1", "junk2", "real"]);
    expect(dropped).toEqual([]);
  });

  it("handles an empty round", () => {
    expect(dedupeLeadsByPhone([])).toEqual({ kept: [], dropped: [] });
  });

  it("preserves the relative order of kept AND dropped leads", () => {
    const { kept, dropped } = dedupeLeadsByPhone([
      lead("k1", "5550000001"),
      lead("d1", "5550000001"),
      lead("k2", "5550000002"),
      lead("d2", "5550000002"),
    ]);
    expect(kept.map((l) => l.id)).toEqual(["k1", "k2"]);
    expect(dropped.map((l) => l.id)).toEqual(["d1", "d2"]);
  });
});
