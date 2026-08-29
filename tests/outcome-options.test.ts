import { describe, expect, it } from "vitest";
import { BEHAVIOR_TO_OUTCOME, SYSTEM_DISPOSITIONS } from "@/lib/dispositions/defs";
import {
  BEHAVIOR_DESCRIPTIONS,
  filterOutcomeOptionsByKeys,
  outcomeConfig,
  resolveDispositionByKey,
  resolveOutcomeOptions,
} from "@/lib/status";
import type { CallOutcome } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// resolveOutcomeOptions is now the org taxonomy end-to-end: the wrap-up grid
// renders exactly the enabled defs in the admin's order, custom buttons submit
// a canonical outcome + their own key, and the legally load-bearing bits
// (do_not_call, canonical stored values) can't be configured away.
// ─────────────────────────────────────────────────────────────────────────────

const CANONICAL: CallOutcome[] = [
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

describe("resolveOutcomeOptions (no settings — the pre-taxonomy default)", () => {
  it("renders the canonical nine, key === value, in wrap-up order", () => {
    const options = resolveOutcomeOptions();
    expect(options).toHaveLength(9);
    expect(options.map((o) => o.value)).toEqual(SYSTEM_DISPOSITIONS.map((d) => d.key));
    for (const o of options) {
      expect(o.key).toBe(o.value);
      expect(CANONICAL).toContain(o.value);
    }
  });

  it("still applies the workspace vocabulary to bills_fine", () => {
    const options = resolveOutcomeOptions({
      leadNoun: "homeowner",
      appointmentNoun: "account review",
      noNeedLabel: "Bills are fine",
    });
    expect(options.find((o) => o.value === "bills_fine")!.label).toBe("Bills are fine");
    expect(options.find((o) => o.value === "appointment_booked")!.description).toBe(
      "Account review scheduled",
    );
  });
});

describe("resolveOutcomeOptions (org settings)", () => {
  it("equals the enabled defs, in stored order", () => {
    const settings = [
      { key: "qualified", label: "Hot lead", tone: "success" },
      { key: "voicemail", label: "Voicemail", tone: "neutral", enabled: false },
      { key: "no_answer", label: "No answer", tone: "neutral" },
    ];
    const options = resolveOutcomeOptions(null, settings);
    // Disabled defs never render.
    expect(options.some((o) => o.key === "voicemail")).toBe(false);
    // Stored order first (qualified before no_answer), appended system rows after.
    const keys = options.map((o) => o.key);
    expect(keys.indexOf("qualified")).toBeLessThan(keys.indexOf("no_answer"));
    // The admin's label wins.
    expect(options.find((o) => o.key === "qualified")!.label).toBe("Hot lead");
  });

  it("a custom def submits its behavior's canonical outcome but carries its own key", () => {
    const settings = [
      {
        key: "x_left_with_spouse",
        label: "Left with spouse",
        tone: "warning",
        behavior: "schedules_callback",
        enabled: true,
      },
    ];
    const options = resolveOutcomeOptions(null, settings);
    const custom = options.find((o) => o.key === "x_left_with_spouse");
    expect(custom).toBeDefined();
    expect(custom!.value).toBe(BEHAVIOR_TO_OUTCOME.schedules_callback);
    expect(custom!.value).toBe("callback_scheduled");
    // Its description explains the pipeline effect the admin's label doesn't.
    expect(custom!.description).toBe(BEHAVIOR_DESCRIPTIONS.schedules_callback);
    // Custom rows NEVER mint a new stored outcome value.
    expect(CANONICAL).toContain(custom!.value);
  });

  it("vocab still re-words an untouched bills_fine row; an admin rename beats vocab", () => {
    const vocab = { leadNoun: "member", appointmentNoun: "visit", noNeedLabel: "Nothing needed" };
    // Untouched system default label → the vertical's wording wins.
    const untouched = resolveOutcomeOptions(vocab, [
      { key: "bills_fine", label: outcomeConfig.bills_fine.label, tone: "warning" },
    ]);
    expect(untouched.find((o) => o.key === "bills_fine")!.label).toBe("Nothing needed");
    // Admin renamed the row → their wording (the most specific override) wins.
    const renamed = resolveOutcomeOptions(vocab, [
      { key: "bills_fine", label: "All good already", tone: "warning" },
    ]);
    expect(renamed.find((o) => o.key === "bills_fine")!.label).toBe("All good already");
  });

  it("do_not_call cannot be disabled out of the grid", () => {
    const options = resolveOutcomeOptions(null, [
      { key: "do_not_call", label: "Do not call", tone: "danger", enabled: false },
    ]);
    expect(options.some((o) => o.key === "do_not_call")).toBe(true);
  });
});

describe("filterOutcomeOptionsByKeys (campaign disposition_keys subset)", () => {
  it("narrows to the allowed keys; empty/absent means no narrowing", () => {
    const options = resolveOutcomeOptions();
    expect(filterOutcomeOptionsByKeys(options, undefined)).toHaveLength(9);
    expect(filterOutcomeOptionsByKeys(options, [])).toHaveLength(9);
    const subset = filterOutcomeOptionsByKeys(options, ["qualified", "no_answer"]);
    expect(subset.map((o) => o.key).sort()).toEqual(
      ["do_not_call", "no_answer", "qualified"].sort(),
    );
  });

  it("do_not_call always survives the filter — it's legally load-bearing", () => {
    const subset = filterOutcomeOptionsByKeys(resolveOutcomeOptions(), ["qualified"]);
    expect(subset.some((o) => o.key === "do_not_call")).toBe(true);
  });

  it("filters custom defs by THEIR key, not the canonical value they collapse to", () => {
    const options = resolveOutcomeOptions(null, [
      {
        key: "x_left_with_spouse",
        label: "Left with spouse",
        tone: "warning",
        behavior: "schedules_callback",
        enabled: true,
      },
    ]);
    const subset = filterOutcomeOptionsByKeys(options, ["x_left_with_spouse"]);
    expect(subset.some((o) => o.key === "x_left_with_spouse")).toBe(true);
    // The system callback row shares the custom row's VALUE but not its key.
    expect(subset.some((o) => o.key === "callback_scheduled")).toBe(false);
  });
});

describe("resolveDispositionByKey", () => {
  it("finds system and custom defs; unknown keys resolve to null", () => {
    const settings = [
      {
        key: "x_wants_info",
        label: "Wants info",
        tone: "neutral",
        behavior: "neutral_end",
        enabled: true,
      },
    ];
    expect(resolveDispositionByKey(settings, "x_wants_info")!.behavior).toBe("neutral_end");
    // System rows exist even when the blob never mentioned them.
    expect(resolveDispositionByKey(settings, "do_not_call")!.system).toBe(true);
    expect(resolveDispositionByKey(settings, "x_never_saved")).toBeNull();
    expect(resolveDispositionByKey(settings, "")).toBeNull();
  });
});
