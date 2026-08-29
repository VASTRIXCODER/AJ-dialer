import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_COLUMN_LABELS,
  EXPORT_MAX_COLUMNS,
  EXPORT_MAX_HEADER_CHARS,
  EXPORT_MAX_TEMPLATES,
  EXPORT_ROW_CAP,
  exportCellKind,
  exportRowLine,
  formatExportCell,
  isExportTruncated,
  sanitizeExportSpec,
  sanitizeExportTemplates,
  type ExportFormat,
} from "@/lib/leads/export-spec";

const FMT: ExportFormat = { delimiter: ",", dateFormat: "iso", nullAs: "", bom: true };

describe("sanitizeExportSpec", () => {
  it("rejects non-objects", () => {
    expect(sanitizeExportSpec(null, [])).toBeNull();
    expect(sanitizeExportSpec("csv please", [])).toBeNull();
    expect(sanitizeExportSpec([], [])).toBeNull();
  });

  it("drops unknown column keys and keeps known ones", () => {
    const spec = sanitizeExportSpec(
      {
        columns: [
          { key: "first_name" },
          { key: "password_hash" }, // not a column this system has
          { key: "latest_outcome" },
          { key: "__proto__" },
        ],
      },
      [],
    );
    expect(spec?.columns.map((c) => c.key)).toEqual(["first_name", "latest_outcome"]);
  });

  it("validates custom keys against the org's OWN allowlist", () => {
    const spec = sanitizeExportSpec(
      {
        columns: [
          { key: "custom:policy_expiry" },
          { key: "custom:someone_elses_field" },
          { key: "custom:Not Normalized" }, // key !== normalizeFieldKey(key)
        ],
      },
      ["policy_expiry"],
    );
    expect(spec?.columns.map((c) => c.key)).toEqual(["custom:policy_expiry"]);
  });

  it("caps at 60 columns and dedupes repeated keys", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      key: i % 2 === 0 ? "first_name" : "last_name",
    }));
    const spec = sanitizeExportSpec(
      { columns: [...many, { key: "city" }, { key: "state" }, { key: "zip" }] },
      [],
    );
    // Dedupe collapses the hundred repeats to two keys; the tail still fits.
    expect(spec?.columns.map((c) => c.key)).toEqual([
      "first_name",
      "last_name",
      "city",
      "state",
      "zip",
    ]);
    const unique = Array.from({ length: 80 }, (_, i) => ({ key: `custom:field_${i}` }));
    const capped = sanitizeExportSpec(
      { columns: unique },
      unique.map((c) => c.key.slice("custom:".length)),
    );
    expect(capped?.columns.length).toBe(EXPORT_MAX_COLUMNS);
  });

  it("keeps a header rename, caps its length, defaults when blank", () => {
    const spec = sanitizeExportSpec(
      {
        columns: [
          { key: "phone", header: "  Mobile number  " },
          { key: "first_name", header: "x".repeat(200) },
          { key: "status", header: "   " },
        ],
      },
      [],
    );
    expect(spec?.columns[0].header).toBe("Mobile number");
    expect(spec?.columns[1].header).toHaveLength(EXPORT_MAX_HEADER_CHARS);
    expect(spec?.columns[2].header).toBe(EXPORT_COLUMN_LABELS.status);
  });

  it("falls back to the default column set only when NO list was sent", () => {
    const absent = sanitizeExportSpec({}, []);
    expect(absent?.columns).toEqual(DEFAULT_EXPORT_COLUMNS);
    // A present list with nothing valid is a refusal, not a silent default.
    expect(sanitizeExportSpec({ columns: [{ key: "nope" }] }, [])).toBeNull();
  });

  it("sanitizes the filter and the format knobs", () => {
    const spec = sanitizeExportSpec(
      {
        filter: {
          op: "and",
          groups: [
            { op: "and", conditions: [{ kind: "core", key: "status", cmp: "eq", value: "new" }] },
          ],
        },
        columns: [{ key: "phone" }],
        format: {
          delimiter: ";",
          dateFormat: "us",
          nullAs: "—",
          bom: false,
          timezone: "America/Chicago",
        },
      },
      [],
    );
    expect(spec?.filter?.groups).toHaveLength(1);
    expect(spec?.format).toEqual({
      delimiter: ";",
      dateFormat: "us",
      nullAs: "—",
      bom: false,
      timezone: "America/Chicago",
    });
    // Garbage knobs degrade to the defaults; malformed zones are dropped.
    const junk = sanitizeExportSpec(
      {
        columns: [{ key: "phone" }],
        filter: "WHERE 1=1",
        format: { delimiter: "|", dateFormat: "eu", nullAs: "N/A", bom: "yes", timezone: "no spaces allowed" },
      },
      [],
    );
    expect(junk?.filter).toBeNull();
    expect(junk?.format).toEqual({ delimiter: ",", dateFormat: "iso", nullAs: "", bom: true });
  });
});

describe("formatExportCell", () => {
  it("prints nullAs for empty values", () => {
    expect(formatExportCell(null, "text", FMT)).toBe("");
    expect(formatExportCell(undefined, "date", FMT)).toBe("");
    expect(formatExportCell("", "number", FMT)).toBe("");
    const dash: ExportFormat = { ...FMT, nullAs: "—" };
    expect(formatExportCell(null, "text", dash)).toBe("—");
    expect(formatExportCell("", "text", dash)).toBe("—");
  });

  it("prints booleans as Yes/No and numbers verbatim", () => {
    expect(formatExportCell(true, "boolean", FMT)).toBe("Yes");
    expect(formatExportCell(false, "boolean", FMT)).toBe("No");
    expect(formatExportCell(42.5, "number", FMT)).toBe("42.5");
  });

  it("formats dates per dateFormat and timezone", () => {
    const when = "2026-01-05T12:30:00Z";
    expect(formatExportCell(when, "date", FMT)).toBe("2026-01-05T12:30:00.000Z");
    expect(formatExportCell(when, "date", { ...FMT, dateFormat: "us" })).toContain("01/05/2026");
    // ISO + a zone renders local wall time in that zone (CST = UTC-6).
    expect(
      formatExportCell(when, "date", { ...FMT, timezone: "America/Chicago" }),
    ).toBe("2026-01-05 06:30:00");
  });

  it("passes unparseable dates through raw and survives a bad zone", () => {
    expect(formatExportCell("whenever", "date", FMT)).toBe("whenever");
    // Shape-valid but nonexistent zone: Intl throws internally → UTC fallback,
    // never an exception into the stream.
    const out = formatExportCell("2026-01-05T12:30:00Z", "date", {
      ...FMT,
      dateFormat: "us",
      timezone: "Not/AZone",
    });
    expect(out).toContain("01/05/2026");
  });
});

describe("exportRowLine (delimiters)", () => {
  it("joins with the chosen delimiter", () => {
    expect(exportRowLine(["a", "b"], FMT)).toBe("a,b");
    expect(exportRowLine(["a", "b"], { ...FMT, delimiter: ";" })).toBe("a;b");
    expect(exportRowLine(["a", "b"], { ...FMT, delimiter: "\t" })).toBe("a\tb");
  });

  it("quotes a cell containing the active delimiter", () => {
    // Comma path (csvCell's own quoting)…
    expect(exportRowLine(["Smith, John", "x"], FMT)).toBe('"Smith, John",x');
    // …and the semicolon path, which csvCell alone would NOT quote.
    expect(exportRowLine(["one;two", "x"], { ...FMT, delimiter: ";" })).toBe('"one;two";x');
  });

  it("keeps formula-lead neutralization from csvCell", () => {
    expect(exportRowLine(["=HYPERLINK()"], FMT)).toBe("'=HYPERLINK()");
  });
});

describe("row cap", () => {
  it("flags truncation only past the cap", () => {
    expect(isExportTruncated(0)).toBe(false);
    expect(isExportTruncated(EXPORT_ROW_CAP)).toBe(false);
    expect(isExportTruncated(EXPORT_ROW_CAP + 1)).toBe(true);
  });
});

describe("exportCellKind", () => {
  it("maps standard keys and custom types to formatter kinds", () => {
    expect(exportCellKind("has_ev")).toBe("boolean");
    expect(exportCellKind("created_at")).toBe("date");
    expect(exportCellKind("attempt_count")).toBe("number");
    expect(exportCellKind("custom:premium", { premium: "currency" })).toBe("number");
    expect(exportCellKind("custom:renewal", { renewal: "date" })).toBe("date");
    expect(exportCellKind("custom:unknown_key")).toBe("text");
  });
});

describe("sanitizeExportTemplates", () => {
  const good = {
    id: "t1",
    name: "Weekly hand-off",
    columns: [{ key: "first_name" }, { key: "phone", header: "Mobile" }],
    format: { delimiter: ";", dateFormat: "us", nullAs: "", bom: true },
  };

  it("keeps well-formed templates and their renamed headers", () => {
    const [t] = sanitizeExportTemplates([good]);
    expect(t.name).toBe("Weekly hand-off");
    expect(t.columns[1]).toEqual({ key: "phone", header: "Mobile" });
    expect(t.format.delimiter).toBe(";");
  });

  it("drops nameless, columnless, and duplicate-id entries; caps at 20", () => {
    const out = sanitizeExportTemplates([
      good,
      { ...good, id: "t1" }, // duplicate id
      { ...good, id: "t2", name: "   " },
      { ...good, id: "t3", columns: [{ key: "junk" }] },
      "not a template",
    ]);
    expect(out.map((t) => t.id)).toEqual(["t1"]);
    const many = Array.from({ length: 30 }, (_, i) => ({ ...good, id: `id${i}` }));
    expect(sanitizeExportTemplates(many)).toHaveLength(EXPORT_MAX_TEMPLATES);
  });

  it("returns [] for junk", () => {
    expect(sanitizeExportTemplates(undefined)).toEqual([]);
    expect(sanitizeExportTemplates({})).toEqual([]);
  });
});
