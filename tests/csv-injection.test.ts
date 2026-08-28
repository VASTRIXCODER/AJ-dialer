import { describe, expect, it } from "vitest";
import { CSV_BOM, CSV_EOL, csvCell, csvLine } from "@/lib/csv-safety";

// The shared CSV encoder — both /api/leads/export and the report export button
// run every cell through this, so formula injection is neutralized everywhere.

describe("csvCell — formula injection", () => {
  it("neutralizes formula-leading cells", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("+cmd|' /C calc'!A0")).toContain("'+cmd");
  });

  it("neutralizes tab/CR-prefixed cells", () => {
    // The apostrophe defuses the formula; CR additionally forces quoting.
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
    expect(csvCell("\r=1+1")).toBe('"\'\r=1+1"');
  });

  it("leaves phones and negative numbers alone", () => {
    expect(csvCell("+14155551234")).toBe("+14155551234");
    expect(csvCell("-42")).toBe("-42");
    expect(csvCell("(415) 555-1234")).toBe("(415) 555-1234");
  });

  it("guards minus-led text that isn't numeric", () => {
    expect(csvCell("-2+3+cmd")).toBe("'-2+3+cmd");
  });

  it("quotes delimiters, quotes, newlines, and edge whitespace", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(" padded ")).toBe('" padded "');
  });

  it("renders null/undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("csvLine / file conventions", () => {
  it("encodes every cell in a row", () => {
    expect(csvLine(["=x", "ok", 5])).toBe("'=x,ok,5");
  });

  it("exports the BOM and CRLF constants Excel needs", () => {
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff);
    expect(CSV_EOL).toBe("\r\n");
  });
});
