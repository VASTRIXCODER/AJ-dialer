import { describe, expect, it } from "vitest";
import { sanitizeSearch, transcriptSnippet } from "@/lib/db/call-archive";
import { flattenTranscript } from "@/lib/db/records";
import { parseTranscript } from "@/components/calls/transcript";

// ─────────────────────────────────────────────────────────────────────────────
// The call archive's pure parts. The round-trip matters most: transcripts are
// STORED flat (so they can be indexed and searched) and RENDERED as turns, so a
// lossy flatten would silently mangle every transcript in the product.
// ─────────────────────────────────────────────────────────────────────────────

describe("flattenTranscript", () => {
  it("labels each turn by speaker, one line each", () => {
    expect(
      flattenTranscript([
        { role: "agent", message: "Hi, is now a good time?", secs: 1 },
        { role: "user", message: "Sure, go ahead.", secs: 4 },
      ]),
    ).toBe("Agent: Hi, is now a good time?\nContact: Sure, go ahead.");
  });

  it("collapses internal newlines so one turn is always one line", () => {
    // Without this the parser would read the second half as an unattributed
    // fragment and attach it to the wrong speaker.
    const flat = flattenTranscript([
      { role: "user", message: "Line one\nline two", secs: null },
    ]);
    expect(flat).toBe("Contact: Line one line two");
    expect(flat!.split("\n")).toHaveLength(1);
  });

  it("drops empty turns and returns null when nothing survives", () => {
    expect(flattenTranscript([{ role: "agent", message: "   ", secs: null }])).toBeNull();
    expect(flattenTranscript([])).toBeNull();
    expect(flattenTranscript(null)).toBeNull();
    expect(flattenTranscript(undefined)).toBeNull();
  });

  it("round-trips through parseTranscript without loss", () => {
    const turns = [
      { role: "agent", message: "Hi there — quick question about your account.", secs: 0 },
      { role: "user", message: "Okay.", secs: 3 },
      { role: "agent", message: "Does Tuesday at 6 work?", secs: 6 },
      { role: "user", message: "Tuesday's fine.", secs: 9 },
    ];
    const parsed = parseTranscript(flattenTranscript(turns));
    expect(parsed).toEqual([
      { role: "agent", message: "Hi there — quick question about your account." },
      { role: "contact", message: "Okay." },
      { role: "agent", message: "Does Tuesday at 6 work?" },
      { role: "contact", message: "Tuesday's fine." },
    ]);
  });
});

describe("parseTranscript", () => {
  it("is tolerant of legacy speaker labels", () => {
    expect(parseTranscript("User: hello\nCustomer: still here")).toEqual([
      { role: "contact", message: "hello" },
      { role: "contact", message: "still here" },
    ]);
  });

  it("appends an unlabelled continuation rather than dropping it", () => {
    expect(parseTranscript("Agent: first part\nsecond part")).toEqual([
      { role: "agent", message: "first part second part" },
    ]);
  });

  it("handles empty and absent input", () => {
    expect(parseTranscript("")).toEqual([]);
    expect(parseTranscript(null)).toEqual([]);
    expect(parseTranscript("   \n  \n")).toEqual([]);
  });
});

describe("transcriptSnippet", () => {
  const text =
    "Agent: Good morning.\nContact: We already renewed with someone else last month.\n" +
    "Agent: Understood — when does that come up again?";

  it("centres the window on the match", () => {
    const snip = transcriptSnippet(text, "already renewed")!;
    expect(snip).toContain("already renewed");
    expect(snip.length).toBeLessThan(200);
  });

  it("returns null when the term isn't in the transcript", () => {
    // A row can match on the lead's NAME while its transcript doesn't contain
    // the term — showing an unrelated first-160-characters snippet there would
    // imply a match that isn't real.
    expect(transcriptSnippet(text, "zzz-not-here")).toBeNull();
  });

  it("falls back to the opening when there's no term", () => {
    expect(transcriptSnippet(text, "")).toContain("Agent: Good morning.");
  });

  it("handles an absent transcript", () => {
    expect(transcriptSnippet(null, "anything")).toBeNull();
  });
});

describe("sanitizeSearch", () => {
  it("strips the characters that would break PostgREST's or() grammar", () => {
    // A comma or bracket terminates the filter list early — the query then means
    // something other than what the rep typed, or 400s outright.
    expect(sanitizeSearch("smith, john")).toBe("smith john");
    expect(sanitizeSearch("acme (west)")).toBe("acme west");
    expect(sanitizeSearch("a*b")).toBe("a b");
    // Quotes delimit a value in the filter grammar.
    expect(sanitizeSearch('say "hello" now')).toBe("say hello now");
    expect(sanitizeSearch("it's fine")).toBe("it s fine");
  });

  it("neutralizes ILIKE wildcards so a literal search stays literal", () => {
    expect(sanitizeSearch("50%")).toBe("50");
    expect(sanitizeSearch("a_b")).toBe("a b");
    expect(sanitizeSearch("back\\slash")).toBe("back slash");
  });

  it("collapses whitespace and caps the length", () => {
    expect(sanitizeSearch("  lots   of   space  ")).toBe("lots of space");
    expect(sanitizeSearch("x".repeat(500)).length).toBe(120);
  });
});
