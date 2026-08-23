import { describe, expect, it } from "vitest";
import {
  CORE_LEAD_FIELDS,
  resolveLeadFields,
  resolveQualifyFields,
} from "@/lib/leads/field-schema";
import { mergeSettings } from "@/lib/org/settings";
import { templateProfile } from "@/lib/org/templates";

// The qualify panel's field list has three sources (org → template preset →
// showInQualify default). "Configured as empty" and "not configured" are
// DIFFERENT answers at the first two levels; collapsing them is what made a
// workspace that switched every field off get the template's fields back.

const schema = resolveLeadFields(undefined, templateProfile("general").fields);
const keysOf = (defs: { key: string }[]) => defs.map((f) => f.key);

describe("resolveQualifyFields", () => {
  it("falls back to the showInQualify defaults when nothing is configured", () => {
    const resolved = resolveQualifyFields(undefined, undefined, schema);
    expect(resolved).toEqual(schema.filter((f) => f.showInQualify));
    expect(resolved.length).toBeGreaterThan(0);
  });

  it("uses the template preset when the org has not chosen", () => {
    const resolved = resolveQualifyFields(undefined, ["utilityBill", "hasEV"], schema);
    expect(keysOf(resolved)).toEqual(["utilityBill", "hasEV"]);
  });

  it("lets the org list win over the template preset", () => {
    const resolved = resolveQualifyFields(["hasPool"], ["utilityBill", "hasEV"], schema);
    expect(keysOf(resolved)).toEqual(["hasPool"]);
  });

  it("honors an explicitly EMPTY org list — briefing-and-notes only", () => {
    // The regression: this used to fall through to the preset and render fields.
    expect(resolveQualifyFields([], ["utilityBill", "hasEV"], schema)).toEqual([]);
    expect(resolveQualifyFields([], undefined, schema)).toEqual([]);
  });

  it("honors an explicitly EMPTY template preset", () => {
    expect(resolveQualifyFields(undefined, [], schema)).toEqual([]);
  });

  it("preserves the configured order, not schema order", () => {
    const resolved = resolveQualifyFields(["hasEV", "utilityBill"], undefined, schema);
    expect(keysOf(resolved)).toEqual(["hasEV", "utilityBill"]);
  });

  it("drops keys that no longer resolve rather than rendering a ghost input", () => {
    const resolved = resolveQualifyFields(["utilityBill", "deleted_custom"], undefined, schema);
    expect(keysOf(resolved)).toEqual(["utilityBill"]);
  });

  it("never renders a slot the template hides", () => {
    // The layout drops template-hidden slots from the schema BEFORE resolving
    // (so the lead panel and search don't surface another vertical's fields);
    // this mirrors that pipeline. Hidden keys then simply don't resolve.
    //
    // Note the flag itself can't be the filter here: insurance's preset
    // deliberately opts `utilityProvider` INTO the qualify flow even though the
    // core slot ships with showInQualify off.
    const hidden = new Set(templateProfile("general").fields?.hidden ?? []);
    const visible = schema.filter((f) => !hidden.has(f.key));
    expect(hidden.has("solarPayment")).toBe(true);
    expect(resolveQualifyFields(["solarPayment"], undefined, visible)).toEqual([]);
  });
});

describe("settings round-trip", () => {
  it("keeps an explicit empty list empty, and an absent one undefined", () => {
    expect(mergeSettings({ qualify: { fields: [] } }).qualify.fields).toEqual([]);
    expect(mergeSettings({ qualify: {} }).qualify.fields).toBeUndefined();
    expect(mergeSettings({}).qualify.fields).toBeUndefined();
  });

  it("survives storage as JSON — the shape the org row actually holds", () => {
    const stored = JSON.parse(JSON.stringify({ qualify: { fields: [] } }));
    const settings = mergeSettings(stored);
    expect(resolveQualifyFields(settings.qualify.fields, undefined, schema)).toEqual([]);
  });

  it("a default org still gets its qualify fields", () => {
    const settings = mergeSettings({});
    const resolved = resolveQualifyFields(settings.qualify.fields, undefined, schema);
    expect(resolved.length).toBeGreaterThan(0);
    expect(keysOf(resolved).every((k) => CORE_LEAD_FIELDS.some((f) => f.key === k))).toBe(true);
  });
});
