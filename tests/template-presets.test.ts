import { describe, expect, it } from "vitest";
import { CORE_LEAD_FIELDS, resolveLeadFields } from "@/lib/leads/field-schema";
import { DEFAULT_DIALER_LAYOUT, mergeSettings } from "@/lib/org/settings";
import { TEMPLATE_PROFILES, templateProfile } from "@/lib/org/templates";

const CORE_KEYS = new Set(CORE_LEAD_FIELDS.map((f) => f.key));
const LAYOUT_KEYS = new Set(Object.keys(DEFAULT_DIALER_LAYOUT));

describe("template field presets", () => {
  it("every relabel/hide targets a real core slot (typo guard)", () => {
    for (const t of TEMPLATE_PROFILES) {
      for (const key of Object.keys(t.fields?.labels ?? {})) {
        expect(CORE_KEYS.has(key), `${t.value} labels ${key}`).toBe(true);
      }
      for (const key of t.fields?.hidden ?? []) {
        expect(CORE_KEYS.has(key), `${t.value} hides ${key}`).toBe(true);
      }
    }
  });

  it("every qualifyFields preset resolves to a visible field", () => {
    for (const t of TEMPLATE_PROFILES) {
      if (!t.qualifyFields) continue;
      const schema = resolveLeadFields(undefined, t.fields);
      const hidden = new Set(t.fields?.hidden ?? []);
      for (const key of t.qualifyFields) {
        expect(
          schema.some((f) => f.key === key),
          `${t.value} qualify key ${key}`,
        ).toBe(true);
        expect(hidden.has(key), `${t.value} qualifies hidden ${key}`).toBe(false);
      }
    }
  });

  it("every dialerLayout preset key is a real layout toggle", () => {
    for (const t of TEMPLATE_PROFILES) {
      for (const key of Object.keys(t.dialerLayout ?? {})) {
        expect(LAYOUT_KEYS.has(key), `${t.value} layout ${key}`).toBe(true);
      }
    }
  });

  it("solar has NO overrides — the flagship keeps today's exact dialer", () => {
    const solar = templateProfile("solar");
    expect(solar.fields).toBeUndefined();
    expect(solar.qualifyFields).toBeUndefined();
    expect(solar.dialerLayout).toBeUndefined();
    // …which means the resolved schema is the core defaults verbatim.
    expect(resolveLeadFields(undefined, solar.fields)).toEqual(CORE_LEAD_FIELDS);
  });

  it("every non-solar template hides both solar slots", () => {
    for (const t of TEMPLATE_PROFILES) {
      if (t.value === "solar") continue;
      const hidden = new Set(t.fields?.hidden ?? []);
      expect(hidden.has("solarPayment"), `${t.value} hides solarPayment`).toBe(true);
      expect(hidden.has("solarProvider"), `${t.value} hides solarProvider`).toBe(true);
    }
  });

  it("insurance relabels the premium slot per the design contract", () => {
    const ins = templateProfile("insurance");
    const schema = resolveLeadFields(undefined, ins.fields);
    expect(schema.find((f) => f.key === "utilityBill")?.label).toBe(
      "Current premium ($/mo)",
    );
  });
});

describe("mergeSettings — dialerLayout & qualify.fields", () => {
  it("keeps dialerLayout PARTIAL (never back-fills to all-on)", () => {
    const s = mergeSettings({ dialerLayout: { floor: false } });
    expect(s.dialerLayout).toEqual({ floor: false });
  });

  it("drops a malformed dialerLayout", () => {
    expect(mergeSettings({ dialerLayout: "nope" }).dialerLayout).toEqual({});
    expect(mergeSettings({ dialerLayout: [1, 2] }).dialerLayout).toEqual({});
    expect(mergeSettings({}).dialerLayout).toEqual({});
  });

  it("carries qualify.fields through and drops non-arrays", () => {
    const s = mergeSettings({ qualify: { fields: ["utilityBill", "hasEV"] } });
    expect(s.qualify.fields).toEqual(["utilityBill", "hasEV"]);
    expect(s.qualify.showSolarPayment).toBe(true); // legacy flags back-filled
    expect(mergeSettings({ qualify: { fields: "x" } }).qualify.fields).toBeUndefined();
    expect(mergeSettings({}).qualify.fields).toBeUndefined();
  });
});
