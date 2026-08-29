import { describe, expect, it } from "vitest";
import {
  BEHAVIOR_TO_OUTCOME,
  customDispositionKey,
  migrateLegacyDispositions,
  resolveDispositionDefs,
  SYSTEM_DISPOSITIONS,
  type DispositionBehavior,
} from "@/lib/dispositions/defs";
import { outcomeConfig } from "@/lib/status";
import type { CallOutcome } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// The disposition taxonomy. The Admin editor used to edit { label, tone } rows
// nothing read; these lock down the keyed, behavior-carrying replacement — and
// above all that stored CallOutcome keys never move or multiply.
// ─────────────────────────────────────────────────────────────────────────────

const CANONICAL_OUTCOMES: CallOutcome[] = [
  "appointment_booked",
  "callback_scheduled",
  "qualified",
  "not_interested",
  "bills_fine",
  "no_answer",
  "voicemail",
  "wrong_number",
  "do_not_call",
];

const ALL_BEHAVIORS: DispositionBehavior[] = [
  "books_appointment",
  "schedules_callback",
  "marks_dnc",
  "marks_qualified",
  "not_interested",
  "no_need",
  "no_answer_retry",
  "voicemail_retry",
  "invalid_number",
  "neutral_end",
];

describe("BEHAVIOR_TO_OUTCOME", () => {
  it("is total over the behavior union and only emits canonical outcomes", () => {
    for (const behavior of ALL_BEHAVIORS) {
      expect(BEHAVIOR_TO_OUTCOME[behavior]).toBeDefined();
      expect(CANONICAL_OUTCOMES).toContain(BEHAVIOR_TO_OUTCOME[behavior]);
    }
    // No stray behaviors beyond the union — a custom row can never invent a
    // stored key.
    expect(Object.keys(BEHAVIOR_TO_OUTCOME).sort()).toEqual([...ALL_BEHAVIORS].sort());
  });
});

describe("SYSTEM_DISPOSITIONS", () => {
  it("covers all 9 canonical outcomes exactly once, key === outcome", () => {
    expect(SYSTEM_DISPOSITIONS).toHaveLength(9);
    expect(SYSTEM_DISPOSITIONS.map((d) => d.key).sort()).toEqual(
      [...CANONICAL_OUTCOMES].sort(),
    );
    for (const def of SYSTEM_DISPOSITIONS) {
      expect(def.system).toBe(true);
      expect(def.enabled).toBe(true);
      // The behavior must round-trip back to the very outcome the row stores.
      expect(BEHAVIOR_TO_OUTCOME[def.behavior]).toBe(def.key);
    }
  });

  it("keeps labels and tones in lockstep with outcomeConfig", () => {
    for (const def of SYSTEM_DISPOSITIONS) {
      const config = outcomeConfig[def.key as CallOutcome];
      expect(def.label).toBe(config.label);
      expect(def.tone).toBe(config.tone);
    }
  });
});

describe("migrateLegacyDispositions", () => {
  it("adopts the system key when a legacy label means a system row", () => {
    const defs = migrateLegacyDispositions([{ label: "Booked!", tone: "success" }]);
    const booked = defs.find((d) => d.key === "appointment_booked");
    expect(booked).toBeDefined();
    expect(booked!.system).toBe(true);
    expect(booked!.enabled).toBe(true);
    // The admin's wording survives the adoption; only the key changes hands.
    expect(booked!.label).toBe("Booked!");
  });

  it("adopts case-insensitively, including the old seeded labels", () => {
    const defs = migrateLegacyDispositions([
      { label: "APPOINTMENT BOOKED", tone: "success" },
      { label: "Callback scheduled", tone: "warning" },
      { label: "not interested", tone: "danger" },
      { label: "No answer", tone: "neutral" },
    ]);
    expect(defs.map((d) => d.key)).toEqual([
      "appointment_booked",
      "callback_scheduled",
      "not_interested",
      "no_answer",
    ]);
    expect(defs.every((d) => d.system)).toBe(true);
  });

  it("preserves an unknown legacy label as a DISABLED x_ custom row", () => {
    const defs = migrateLegacyDispositions([{ label: "Left with spouse", tone: "warning" }]);
    const custom = defs.find((d) => !d.system);
    expect(custom).toBeDefined();
    expect(custom!.key).toBe("x_left_with_spouse");
    expect(custom!.enabled).toBe(false);
    expect(custom!.label).toBe("Left with spouse");
    expect(custom!.behavior).toBe("neutral_end");
  });

  it("returns the system set for empty or absent legacy settings", () => {
    expect(migrateLegacyDispositions([])).toEqual(SYSTEM_DISPOSITIONS);
    expect(migrateLegacyDispositions(undefined)).toEqual(SYSTEM_DISPOSITIONS);
    expect(migrateLegacyDispositions(null)).toEqual(SYSTEM_DISPOSITIONS);
    expect(migrateLegacyDispositions("garbage")).toEqual(SYSTEM_DISPOSITIONS);
  });
});

describe("resolveDispositionDefs", () => {
  it("guarantees every system key is present even from a sparse legacy blob", () => {
    const defs = resolveDispositionDefs([{ label: "No answer", tone: "neutral" }]);
    for (const outcome of CANONICAL_OUTCOMES) {
      expect(defs.some((d) => d.key === outcome)).toBe(true);
    }
  });

  it("never lets do_not_call be disabled", () => {
    const defs = resolveDispositionDefs([
      { label: "Do not call", tone: "danger", enabled: false },
    ]);
    const dnc = defs.find((d) => d.key === "do_not_call");
    expect(dnc!.enabled).toBe(true);
  });

  it("reassigns a stable, gap-free sortOrder", () => {
    const defs = resolveDispositionDefs([
      { label: "Zebra custom", tone: "neutral" },
      { label: "Qualified", tone: "success" },
    ]);
    expect(defs.map((d) => d.sortOrder)).toEqual(defs.map((_, i) => i));
    // Legacy rows keep their position; appended system rows follow.
    expect(defs[0].key).toBe("x_zebra_custom");
    expect(defs[1].key).toBe("qualified");
  });
});

describe("customDispositionKey", () => {
  it("slugs spaces and punctuation into x_ keys", () => {
    expect(customDispositionKey("Left with spouse")).toBe("x_left_with_spouse");
    expect(customDispositionKey("Wants info — email!")).toBe("x_wants_info_email");
    expect(customDispositionKey("  Follow-up (Q3)  ")).toBe("x_follow_up_q3");
  });

  it("strips diacritics and survives label text with no usable characters", () => {
    expect(customDispositionKey("Café résumé")).toBe("x_cafe_resume");
    expect(customDispositionKey("★★★")).toBe("x_custom");
  });
});
