import { describe, expect, it } from "vitest";
import {
  detectFieldType,
  normalizeFieldKey,
  parseFieldValue,
} from "@/lib/leads/field-schema";
import {
  MAX_CUSTOM_FIELDS,
  MAX_TABLE_CUSTOM_FIELDS,
  mergeDiscoveredLeadFields,
  rowsToLeads,
  sanitizeDiscoveredFields,
} from "@/lib/leads/csv";
import type { LeadFieldDef } from "@/lib/leads/field-schema";

describe("normalizeFieldKey", () => {
  it("snake_cases a header, trimming edges and punctuation", () => {
    expect(normalizeFieldKey("Policy Expiry ")).toBe("policy_expiry");
    expect(normalizeFieldKey("  Has EV?")).toBe("has_ev");
    expect(normalizeFieldKey("Renewal—Date (2024)")).toBe("renewal_date_2024");
  });

  it("returns '' when nothing survives", () => {
    expect(normalizeFieldKey("%%%")).toBe("");
    expect(normalizeFieldKey("   ")).toBe("");
  });

  it("caps the key at 48 characters", () => {
    expect(normalizeFieldKey("x".repeat(80)).length).toBe(48);
  });
});

describe("detectFieldType", () => {
  it("detects currency from $-prefixed values", () => {
    expect(detectFieldType(["$100", "$250.50", "$1,200"])).toBe("currency");
  });

  it("detects currency from $-less cents-dominant amounts", () => {
    expect(detectFieldType(["120.50", "99.00"])).toBe("currency");
  });

  it("detects plain numbers", () => {
    expect(detectFieldType(["120", "99", "7"])).toBe("number");
  });

  it("detects booleans from yes/no", () => {
    expect(detectFieldType(["Yes", "no", "YES"])).toBe("boolean");
  });

  it("detects dates, emails, urls, and phones", () => {
    expect(detectFieldType(["2026-01-15", "2026-02-20"])).toBe("date");
    expect(detectFieldType(["a@b.com", "c@d.org"])).toBe("email");
    expect(detectFieldType(["https://x.com", "http://y.co/z"])).toBe("url");
    expect(detectFieldType(["415-555-1234", "(212) 555-9999"])).toBe("phone");
  });

  it("stays text for mixed or empty columns", () => {
    expect(detectFieldType(["hello", "123"])).toBe("text");
    expect(detectFieldType([])).toBe("text");
  });
});

describe("parseFieldValue", () => {
  it("coerces currency and numbers", () => {
    expect(parseFieldValue("$1,234.50", "currency")).toBe(1234.5);
    expect(parseFieldValue("42", "number")).toBe(42);
  });

  it("keeps the raw string when a number can't be parsed", () => {
    expect(parseFieldValue("-", "number")).toBe("-");
  });

  it("coerces booleans", () => {
    expect(parseFieldValue("Yes", "boolean")).toBe(true);
    expect(parseFieldValue("No", "boolean")).toBe(false);
  });

  it("passes text through", () => {
    expect(parseFieldValue(" PN-1001 ", "text")).toBe("PN-1001");
  });
});

describe("rowsToLeads custom-field capture", () => {
  const grid = [
    ["Name", "Phone", "Policy Number", "Premium", "Renewal Date", "Has Pets", "", "Empty Col"],
    ["Jane Doe", "4155551234", "PN-1001", "$120.50", "2026-01-15", "Yes", "orphan", ""],
    ["John Smith", "4155551235", "PN-1002", "$99.00", "2026-02-20", "No", "orphan", ""],
  ];

  it("captures every unmapped column as a typed custom field", () => {
    const { leads } = rowsToLeads(grid);
    expect(leads).toHaveLength(2);
    expect(leads[0].customFields).toEqual({
      policy_number: "PN-1001",
      premium: 120.5,
      renewal_date: "2026-01-15",
      has_pets: true,
    });
    expect(leads[1].customFields?.has_pets).toBe(false);
    // Core mapping is untouched by the capture.
    expect(leads[0].firstName).toBe("Jane");
    expect(leads[0].phone).toBe("+14155551234");
  });

  it("returns typed defs for the discovered fields", () => {
    const { discoveredFields } = rowsToLeads(grid);
    expect(discoveredFields.map((f) => [f.key, f.type])).toEqual([
      ["policy_number", "text"],
      ["premium", "currency"],
      ["renewal_date", "date"],
      ["has_pets", "boolean"],
    ]);
    for (const f of discoveredFields) {
      expect(f.source).toBe("custom");
      expect(f.showInQualify).toBe(false);
    }
    // Labels keep the header's original presentation.
    expect(discoveredFields[0].label).toBe("Policy Number");
  });

  it("drops empty headers and all-empty columns", () => {
    const { leads, discoveredFields } = rowsToLeads(grid);
    const keys = discoveredFields.map((f) => f.key);
    expect(keys).not.toContain("empty_col");
    // The headerless "orphan" column has no key to live under.
    expect(Object.values(leads[0].customFields ?? {})).not.toContain("orphan");
  });

  it("skips a cell that is empty without inventing a value", () => {
    const sparse = [
      ["Name", "Phone", "Tier"],
      ["Jane Doe", "4155551234", "Gold"],
      ["John Smith", "4155551235", ""],
    ];
    const { leads } = rowsToLeads(sparse);
    expect(leads[0].customFields).toEqual({ tier: "Gold" });
    expect(leads[1].customFields).toBeUndefined();
  });

  it("keeps only the first of two headers that normalize to the same key", () => {
    const dup = [
      ["Name", "Phone", "Spouse Name?", "Spouse name"],
      ["Jane Doe", "4155551234", "Alex", "Sam"],
    ];
    const { leads, discoveredFields } = rowsToLeads(dup);
    expect(discoveredFields.filter((f) => f.key === "spouse_name")).toHaveLength(1);
    expect(leads[0].customFields?.spouse_name).toBe("Alex");
  });

  it(`caps capture at ${MAX_CUSTOM_FIELDS} custom fields per import`, () => {
    const extraCols = Array.from({ length: 40 }, (_, i) => `Extra Col ${i + 1}`);
    const wide = [
      ["Name", "Phone", ...extraCols],
      ["Jane Doe", "4155551234", ...extraCols.map((_, i) => `v${i}`)],
    ];
    const { leads, discoveredFields } = rowsToLeads(wide);
    expect(discoveredFields).toHaveLength(MAX_CUSTOM_FIELDS);
    expect(Object.keys(leads[0].customFields ?? {})).toHaveLength(MAX_CUSTOM_FIELDS);
  });
});

describe("sanitizeDiscoveredFields", () => {
  it("returns [] for non-arrays", () => {
    expect(sanitizeDiscoveredFields(undefined)).toEqual([]);
    expect(sanitizeDiscoveredFields("nope")).toEqual([]);
  });

  it("REJECTS non-normalized keys (silently renaming would orphan row values)", () => {
    const out = sanitizeDiscoveredFields([
      // Not normalized — renaming to policy_number would register the def
      // under a different key than the round-tripped row values carry.
      { key: "Policy Number", label: "Policy Number", type: "text", source: "core", showInTable: true, showInQualify: true },
      { key: "premium", label: "", type: "currency" },
      { key: "evil", label: "Evil", type: "script" }, // unknown type dropped
      { key: "%%%", label: "No key", type: "text" }, // unkeyable dropped
      null,
    ]);
    expect(out.map((f) => f.key)).toEqual(["premium"]);
    expect(out[0].label).toBe("premium"); // empty label falls back to the key
    for (const f of out) {
      expect(f.source).toBe("custom");
      expect(f.showInTable).toBe(false);
      expect(f.showInQualify).toBe(false);
    }
  });

  it("keeps already-normalized keys and drops reserved ones", () => {
    const out = sanitizeDiscoveredFields([
      { key: "has_pets", label: "Has Pets", type: "boolean" },
      { key: "status", label: "Status", type: "text" }, // reserved — never a custom field
      { key: "ai_score", label: "AI Score", type: "number" }, // reserved
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("has_pets");
    expect(out[0].type).toBe("boolean");
  });

  it("normalizeFieldKey is idempotent even at the length cap", () => {
    const long = "Estimated Annual Household Discretionary Income USD";
    const key = normalizeFieldKey(long);
    expect(key.endsWith("_")).toBe(false);
    expect(normalizeFieldKey(key)).toBe(key);
  });

  it("parseFieldValue keeps digit-less placeholders as text, not 0", () => {
    expect(parseFieldValue("N/A", "currency")).toBe("N/A");
    expect(parseFieldValue("TBD", "number")).toBe("TBD");
    expect(parseFieldValue("$", "currency")).toBe("$");
    expect(parseFieldValue("$250", "currency")).toBe(250);
  });

  it("detectFieldType keeps identifier-shaped numerics as text", () => {
    expect(detectFieldType(["00123", "00456", "07890"])).toBe("text");
    expect(detectFieldType(["9007199254740993111", "9007199254740993112"])).toBe("text");
    expect(detectFieldType(["12", "34", "56"])).toBe("number");
  });
});

describe("mergeDiscoveredLeadFields", () => {
  const def = (key: string, over: Partial<LeadFieldDef> = {}): LeadFieldDef => ({
    key,
    label: key,
    type: "text",
    source: "custom",
    showInTable: false,
    showInQualify: false,
    ...over,
  });

  it("appends new fields, table-visible up to the cap, never qualify-visible", () => {
    const discovered = ["a", "b", "c", "d", "e", "f"].map((k) => def(k));
    const { fields, added } = mergeDiscoveredLeadFields([], discovered);
    expect(added).toBe(6);
    expect(fields.map((f) => f.showInTable)).toEqual([true, true, true, true, false, false]);
    expect(fields.every((f) => !f.showInQualify)).toBe(true);
  });

  it("never duplicates or overwrites an existing def", () => {
    const existing = [def("premium", { label: "Monthly premium", type: "currency", showInTable: true })];
    const { fields, added } = mergeDiscoveredLeadFields(existing, [
      def("premium", { label: "Premium", type: "text" }),
      def("tier"),
    ]);
    expect(added).toBe(1);
    expect(fields).toHaveLength(2);
    expect(fields[0].label).toBe("Monthly premium");
    expect(fields[0].type).toBe("currency");
  });

  it("counts existing visible custom fields against the table cap", () => {
    const existing = Array.from({ length: MAX_TABLE_CUSTOM_FIELDS - 1 }, (_, i) =>
      def(`old_${i}`, { showInTable: true }),
    );
    const { fields } = mergeDiscoveredLeadFields(existing, [def("x"), def("y")]);
    const appended = fields.slice(existing.length);
    expect(appended.map((f) => f.showInTable)).toEqual([true, false]);
  });

  it("returns the existing array untouched when nothing is new", () => {
    const existing = [def("premium")];
    const { fields, added } = mergeDiscoveredLeadFields(existing, [def("premium")]);
    expect(added).toBe(0);
    expect(fields).toBe(existing);
  });
});
