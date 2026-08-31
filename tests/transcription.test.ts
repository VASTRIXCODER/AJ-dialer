import { describe, expect, it } from "vitest";
import {
  turnsFromDeepgramUtterances,
  turnsFromScribeWords,
  type ScribeWord,
} from "@/lib/calls/transcription";
import { flattenTranscript } from "@/lib/db/records";

// A Scribe word stream for: contact "Hello?" then rep "Hi, this is Dana."
// `detect_speaker_roles` labels the voices agent/customer.
const roleLabelled: ScribeWord[] = [
  { text: "Hello", start: 0.4, type: "word", speaker_id: "customer" },
  { text: "?", start: 0.8, type: "word", speaker_id: "customer" },
  { text: " ", type: "spacing", speaker_id: "customer" },
  { text: "Hi", start: 1.6, type: "word", speaker_id: "agent" },
  { text: ",", start: 1.7, type: "word", speaker_id: "agent" },
  { text: " ", type: "spacing", speaker_id: "agent" },
  { text: "this", start: 1.9, type: "word", speaker_id: "agent" },
  { text: " ", type: "spacing", speaker_id: "agent" },
  { text: "is", start: 2.1, type: "word", speaker_id: "agent" },
  { text: " ", type: "spacing", speaker_id: "agent" },
  { text: "Dana", start: 2.3, type: "word", speaker_id: "agent" },
  { text: ".", start: 2.6, type: "word", speaker_id: "agent" },
];

describe("turnsFromScribeWords", () => {
  it("groups consecutive words into one turn per speaker", () => {
    const turns = turnsFromScribeWords(roleLabelled);
    expect(turns).toHaveLength(2);
    expect(turns[0].message).toBe("Hello?");
    expect(turns[1].message).toBe("Hi, this is Dana.");
  });

  it("maps agent/customer labels onto rep and contact exactly", () => {
    const turns = turnsFromScribeWords(roleLabelled);
    // The rep is "agent"; the person who answered is "user" (renders Contact).
    expect(turns[0].role).toBe("user");
    expect(turns[1].role).toBe("agent");
  });

  it("keeps the start time of each turn for seeking", () => {
    const turns = turnsFromScribeWords(roleLabelled);
    expect(turns[0].secs).toBe(0.4);
    expect(turns[1].secs).toBe(1.6);
  });

  it("drops audio events so [laughter] never lands in a call record", () => {
    const turns = turnsFromScribeWords([
      { text: "[laughter]", start: 0.1, type: "audio_event", speaker_id: "customer" },
      { text: "Sure", start: 0.5, type: "word", speaker_id: "customer" },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].message).toBe("Sure");
  });

  it("falls back to speaker order when roles aren't detected", () => {
    // No agent/customer labels — on an OUTBOUND call the first voice is the
    // person picking up, so speaker_0 is the contact and speaker_1 the rep.
    const turns = turnsFromScribeWords([
      { text: "Hello", start: 0.2, type: "word", speaker_id: "speaker_0" },
      { text: "Hi", start: 1.0, type: "word", speaker_id: "speaker_1" },
    ]);
    expect(turns[0].role).toBe("user");
    expect(turns[1].role).toBe("agent");
  });

  it("returns nothing for silence rather than an empty turn", () => {
    expect(turnsFromScribeWords([])).toEqual([]);
    expect(
      turnsFromScribeWords([{ text: "   ", type: "word", speaker_id: "speaker_0" }]),
    ).toEqual([]);
  });
});

describe("turnsFromDeepgramUtterances", () => {
  it("maps utterances to turns, first speaker as the contact", () => {
    const turns = turnsFromDeepgramUtterances([
      { start: 0.3, transcript: "Hello?", speaker: 0 },
      { start: 1.5, transcript: "Hi, this is Dana.", speaker: 1 },
      { start: 4.0, transcript: "Sure, go ahead.", speaker: 0 },
    ]);
    expect(turns.map((t) => t.role)).toEqual(["user", "agent", "user"]);
    expect(turns[1].message).toBe("Hi, this is Dana.");
    expect(turns[2].secs).toBe(4.0);
  });

  it("skips empty utterances", () => {
    const turns = turnsFromDeepgramUtterances([
      { start: 0, transcript: "   ", speaker: 0 },
      { start: 1, transcript: "Okay", speaker: 1 },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].message).toBe("Okay");
  });
});

describe("round-trip into the archive format", () => {
  it("flattens to the Agent:/Contact: text the transcript panel parses", () => {
    const text = flattenTranscript(turnsFromScribeWords(roleLabelled));
    expect(text).toBe("Contact: Hello?\nAgent: Hi, this is Dana.");
  });

  it("collapses a turn's internal newlines so one turn stays one line", () => {
    const text = flattenTranscript([
      { role: "user", message: "line one\nline two", secs: 0 },
    ]);
    expect(text).toBe("Contact: line one line two");
  });
});
