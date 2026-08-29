import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectDelimiter, parseSheet } from "@/lib/leads/csv";
import { parseCsvToLeads } from "@/lib/leads/parse-request";

// ─────────────────────────────────────────────────────────────────────────────
// The delimiter override. detectDelimiter counts characters on the first line,
// so a TSV whose cells legitimately contain commas ("Smith, Jane, Jr.") gets
// mis-detected as a CSV and every column shifts. The Import Studio lets a human
// say "this is a TSV", and that explicit choice must beat detection everywhere.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

describe("explicit delimiter beats detection", () => {
  // Row 0 has MORE commas than tabs — detection alone picks the wrong one.
  const tsv = [
    "Smith, Jane, Jr.\t+12145550001\tDallas",
    "Jones, Bob\t+12145550002\tPlano",
  ].join("\n");

  it("detection genuinely gets this file wrong (the premise)", () => {
    expect(detectDelimiter(tsv.split("\n")[0])).toBe(",");
    // Split on commas, the name shatters across cells and the columns shift.
    const wrong = parseSheet(tsv);
    expect(wrong[0][0]).toBe("Smith");
    expect(wrong[0]).not.toContain("Smith, Jane, Jr.");
  });

  it("parseSheet honors the explicit delimiter", () => {
    const grid = parseSheet(tsv, "\t");
    expect(grid).toHaveLength(2);
    expect(grid[0]).toEqual(["Smith, Jane, Jr.", "+12145550001", "Dallas"]);
  });

  it("parseCsvToLeads carries the override end to end", async () => {
    const parsed = await parseCsvToLeads(tsv, { hasHeader: false, delimiter: "\t" });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.leads).toHaveLength(2);
    expect(parsed.leads[0].phone).toBe("+12145550001");
  });
});

describe("TSV with commas inside quoted cells", () => {
  it("keeps a quoted, comma-carrying address in one column", async () => {
    const tsv = [
      "Name\tPhone\tAddress",
      'Jane Smith\t+12145550001\t"123 Main St, Apt 4, Dallas"',
    ].join("\n");
    const parsed = await parseCsvToLeads(tsv, { delimiter: "\t" });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.leads).toHaveLength(1);
    expect(parsed.leads[0].address).toContain("123 Main St, Apt 4");
    expect(parsed.leads[0].phone).toBe("+12145550001");
  });
});
