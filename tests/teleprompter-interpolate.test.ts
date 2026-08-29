import { describe, expect, it } from "vitest";
import {
  buildTeleprompterSections,
  interpolateScript,
  splitScriptSections,
} from "@/lib/dialer/teleprompter";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import type { Lead } from "@/lib/types";

// The teleprompter's text engine: section splitting and {{field}}
// interpolation. The invariant that matters most: a missing value is a
// MISSING token (value null) — the pane may never invent or guess a value the
// rep would then read aloud.

const FIELDS: LeadFieldDef[] = [
  { key: "utilityBill", label: "Utility bill ($/mo)", type: "currency", source: "core", showInTable: true, showInQualify: true },
  { key: "utilityProvider", label: "Utility provider", type: "text", source: "core", showInTable: false, showInQualify: false },
  { key: "policy_number", label: "Policy number", type: "text", source: "custom", showInTable: false, showInQualify: false },
];

const LEAD: Lead = {
  id: "lead-1",
  firstName: "Dana",
  lastName: "Reyes",
  phone: "+15125550100",
  address: "12 Oak St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  utilityProvider: "Austin Energy",
  solarProvider: "",
  utilityBill: 240,
  status: "new",
  campaignId: "",
  hasEV: false,
  hasPool: false,
  hasBattery: false,
  multipleSystems: false,
  createdAt: "2026-01-01T00:00:00Z",
  timezone: "",
  customFields: { policy_number: "PN-1187" },
};

describe("splitScriptSections", () => {
  it("splits on markdown headings, prefacing leading text as Opening", () => {
    const text = "Hello there.\n\n# Intro\nSay hi.\n## Pitch\nSell it.";
    const sections = splitScriptSections(text);
    expect(sections.map((s) => s.title)).toEqual(["Opening", "Intro", "Pitch"]);
    expect(sections[1].body).toBe("Say hi.");
    expect(sections[2].body).toBe("Sell it.");
  });

  it("treats **bold-only** lines as headings", () => {
    const sections = splitScriptSections("**Greeting**\nHi!\n**Close**\nBook it.");
    expect(sections.map((s) => s.title)).toEqual(["Greeting", "Close"]);
  });

  it("falls back to blank-line groups titled by their first line", () => {
    const sections = splitScriptSections("First paragraph here.\n\nSecond one.");
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("First paragraph here.");
    expect(sections[1].body).toBe("Second one.");
  });

  it("keeps an unbroken script as one section and drops empty input", () => {
    expect(splitScriptSections("Just one line.")).toHaveLength(1);
    expect(splitScriptSections("")).toEqual([]);
    expect(splitScriptSections("   \n  ")).toEqual([]);
  });
});

describe("interpolateScript", () => {
  it("resolves schema fields by key with formatted values", () => {
    const tokens = interpolateScript("Bill is {{utilityBill}} today.", LEAD, FIELDS);
    expect(tokens).toEqual([
      { kind: "text", text: "Bill is " },
      { kind: "field", key: "utilityBill", label: "Utility bill ($/mo)", value: "$240" },
      { kind: "text", text: " today." },
    ]);
  });

  it("matches by label, case- and spacing-insensitively", () => {
    const tokens = interpolateScript("With {{ Utility Provider }}.", LEAD, FIELDS);
    const field = tokens.find((t) => t.kind === "field");
    expect(field).toMatchObject({ key: "utilityProvider", value: "Austin Energy" });
  });

  it("resolves identity slots (firstName etc.) that aren't in the org schema", () => {
    const tokens = interpolateScript("Hi {{first name}} from {{city}}!", LEAD, FIELDS);
    const fields = tokens.filter((t) => t.kind === "field");
    expect(fields[0]).toMatchObject({ key: "firstName", value: "Dana" });
    expect(fields[1]).toMatchObject({ key: "city", value: "Austin" });
  });

  it("reads custom fields off customFields", () => {
    const tokens = interpolateScript("Policy {{policy_number}}.", LEAD, FIELDS);
    expect(tokens.find((t) => t.kind === "field")).toMatchObject({ value: "PN-1187" });
  });

  it("renders a MISSING token for an empty value — never a guessed one", () => {
    const tokens = interpolateScript("Their provider: {{solarProvider}}", LEAD, [
      ...FIELDS,
      { key: "solarProvider", label: "Solar provider", type: "text", source: "core", showInTable: false, showInQualify: false },
    ]);
    expect(tokens.find((t) => t.kind === "field")).toMatchObject({
      key: "solarProvider",
      value: null,
    });
  });

  it("renders a MISSING token for an unknown placeholder, keeping its name", () => {
    const tokens = interpolateScript("Ask about {{Spouse Name}}.", LEAD, FIELDS);
    expect(tokens.find((t) => t.kind === "field")).toMatchObject({
      label: "Spouse Name",
      value: null,
    });
  });

  it("treats every field as missing when there is no lead", () => {
    const tokens = interpolateScript("Hi {{firstName}}", null, FIELDS);
    expect(tokens.find((t) => t.kind === "field")).toMatchObject({ value: null });
  });

  it("never leaks raw braces into text tokens", () => {
    const tokens = interpolateScript("A {{utilityBill}} B {{unknown_x}} C", LEAD, FIELDS);
    const text = tokens
      .filter((t) => t.kind === "text")
      .map((t) => (t.kind === "text" ? t.text : ""))
      .join("");
    expect(text).not.toContain("{{");
    expect(text).not.toContain("}}");
  });
});

describe("buildTeleprompterSections", () => {
  it("splits and interpolates in one pass", () => {
    const sections = buildTeleprompterSections(
      "# Open\nHi {{firstName}}.\n# Close\nBye.",
      LEAD,
      FIELDS,
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].tokens.find((t) => t.kind === "field")).toMatchObject({
      value: "Dana",
    });
  });
});
