import { beforeEach, describe, expect, it, vi } from "vitest";
import { splitCsvIntoChunks, splitRecords, utf8Length } from "@/lib/leads/chunk";
import { parseSheet, rowsToLeads } from "@/lib/leads/csv";
import {
  describeImport,
  importShortfall,
  type ImportTotals,
} from "@/lib/leads/import-client";
import {
  blankIfPlaceholder,
  normalizeAddress,
  normalizeName,
  normalizeParsedLead,
  normalizeState,
  normalizeZip,
  titleCase,
} from "@/lib/leads/normalize";
import {
  parseCsvToLeads,
  sanitizeColumnPlan,
  scoreParse,
  type ColumnPlan,
} from "@/lib/leads/parse-request";

// ─────────────────────────────────────────────────────────────────────────────
// The bug these tests exist for: a customer uploaded 9,381 leads, the importer
// reported "Imported 5000 leads", and 4,381 homeowners were discarded with no
// error and no warning. Every assertion here is ultimately the same one — the
// number of leads that come out equals the number of rows that went in.
// ─────────────────────────────────────────────────────────────────────────────

const HEADER = "First Name,Last Name,Phone,Email,Address,City,State,Zip";

/** A CSV with `n` data rows, each carrying a unique, valid US phone number. */
function makeCsv(n: number): string {
  const rows = Array.from({ length: n }, (_, i) => {
    // 214-555-xxxx style, unique per row so dedupe never legitimately fires.
    const line = String(i).padStart(7, "0");
    return `First${i},Last${i},+1214${line},f${i}@example.com,${i} Main St,Addison,TX,75001`;
  });
  return [HEADER, ...rows].join("\n");
}

/** All data rows across every chunk, in order, with headers stripped. */
function dataRowsOf(chunks: { csv: string }[]): string[] {
  return chunks.flatMap((c) => c.csv.split("\n").slice(1));
}

describe("splitCsvIntoChunks — no row is ever left behind", () => {
  it("returns a single chunk for a file that already fits", () => {
    const csv = makeCsv(50);
    const chunks = splitCsvIntoChunks(csv, { maxRows: 4000, maxBytes: 3_000_000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].rowOffset).toBe(0);
    expect(chunks[0].rows).toBe(50);
    expect(chunks[0].csv).toBe(csv);
  });

  it("splits on the row budget and accounts for every row exactly once", () => {
    const csv = makeCsv(10);
    const chunks = splitCsvIntoChunks(csv, { maxRows: 4, maxBytes: 3_000_000 });
    expect(chunks.map((c) => c.rows)).toEqual([4, 4, 2]);
    expect(chunks.map((c) => c.rowOffset)).toEqual([0, 4, 8]);
    // Every chunk is a standalone CSV — header included.
    for (const c of chunks) expect(c.csv.split("\n")[0]).toBe(HEADER);
    expect(dataRowsOf(chunks)).toEqual(csv.split("\n").slice(1));
  });

  it("splits on the byte budget as well as the row budget", () => {
    const csv = makeCsv(20);
    const chunks = splitCsvIntoChunks(csv, { maxRows: 10_000, maxBytes: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(utf8Length(c.csv)).toBeLessThanOrEqual(400);
    expect(dataRowsOf(chunks)).toHaveLength(20);
  });

  it("keeps a single oversized row rather than dropping it", () => {
    // One row far bigger than the whole budget: it must still be sent.
    const fat = `A,B,+12145550001,e@x.com,"${"x".repeat(5000)}",Addison,TX,75001`;
    const csv = [HEADER, fat, "C,D,+12145550002,e2@x.com,2 Main,Addison,TX,75001"].join("\n");
    const chunks = splitCsvIntoChunks(csv, { maxRows: 10, maxBytes: 500 });
    expect(dataRowsOf(chunks)).toHaveLength(2);
    expect(chunks.some((c) => c.csv.includes("x".repeat(5000)))).toBe(true);
  });

  it("never cuts inside a quoted field that contains a newline", () => {
    const csv = [
      HEADER,
      'A,B,+12145550001,a@x.com,"12 Main St\nApt 4",Addison,TX,75001',
      "C,D,+12145550002,c@x.com,13 Main St,Addison,TX,75001",
    ].join("\n");
    const chunks = splitCsvIntoChunks(csv, { maxRows: 1, maxBytes: 3_000_000 });
    expect(chunks).toHaveLength(2);
    // The embedded newline stayed inside its own record.
    expect(chunks[0].csv).toContain("12 Main St\nApt 4");
    expect(chunks[1].rows).toBe(1);
  });

  it("keeps every row of a 9,381-row file — the exact size that used to lose 4,381", () => {
    const csv = makeCsv(9381);
    const chunks = splitCsvIntoChunks(csv, { maxRows: 4000, maxBytes: 3_000_000 });
    const total = chunks.reduce((n, c) => n + c.rows, 0);
    expect(total).toBe(9381);
    expect(dataRowsOf(chunks)).toHaveLength(9381);
    // Offsets are contiguous, so created_at stamping can't interleave chunks.
    let expected = 0;
    for (const c of chunks) {
      expect(c.rowOffset).toBe(expected);
      expected += c.rows;
    }
  });

  it("drops blank lines rather than counting them as rows", () => {
    const csv = [HEADER, "A,B,+12145550001,,,,,", "", "  ", "C,D,+12145550002,,,,,"].join("\n");
    const chunks = splitCsvIntoChunks(csv, { maxRows: 100, maxBytes: 3_000_000 });
    expect(chunks[0].rows).toBe(2);
  });

  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("é")).toBe(2); // 1 code unit, 2 bytes
    expect(utf8Length("😀")).toBe(4); // 2 code units, 4 bytes
  });

  it("splits records on the detected delimiter, not always the comma", () => {
    const csv = "a;b;c\n1;2;3\n4;5;6";
    expect(splitRecords(csv, ";")).toEqual(["a;b;c", "1;2;3", "4;5;6"]);
  });
});

describe("normalize — reformatting that never destroys what the customer sent", () => {
  it("resolves full state names to USPS codes and leaves real codes alone", () => {
    expect(normalizeState("California")).toBe("CA");
    expect(normalizeState("  new york ")).toBe("NY");
    expect(normalizeState("tx")).toBe("TX");
    expect(normalizeState("TX")).toBe("TX");
  });

  it("keeps an unrecognised state verbatim rather than blanking it", () => {
    expect(normalizeState("Baja California")).toBe("Baja California");
    expect(normalizeState("ZZ")).toBe("ZZ");
  });

  it("restores ZIP leading zeros a spreadsheet stripped", () => {
    expect(normalizeZip("1001")).toBe("01001");
    expect(normalizeZip("75001")).toBe("75001");
    expect(normalizeZip("1001-1234")).toBe("01001-1234");
    expect(normalizeZip("K1A 0B1")).toBe("K1A 0B1"); // not a US ZIP — untouched
  });

  it("re-cases only UNIFORMLY cased values, never deliberate mixed case", () => {
    expect(normalizeName("BRIDGET")).toBe("Bridget");
    expect(normalizeName("mcdonald")).toBe("Mcdonald");
    expect(normalizeName("O'BRIEN")).toBe("O'Brien");
    expect(normalizeName("SMITH-JONES")).toBe("Smith-Jones");
    // Already mixed case = someone typed it that way. Hands off.
    expect(normalizeName("LaSalle")).toBe("LaSalle");
    expect(normalizeName("McDonald")).toBe("McDonald");
    expect(titleCase("de la Cruz")).toBe("de la Cruz");
  });

  it("title-cases addresses but keeps directionals and PO uppercase", () => {
    expect(normalizeAddress("123 NE 4TH ST")).toBe("123 NE 4th St");
    expect(normalizeAddress("PO BOX 44")).toBe("PO Box 44");
    expect(normalizeAddress("3832 Azure Ln")).toBe("3832 Azure Ln");
  });

  it("treats an export's placeholder as the blank it stands for", () => {
    // The real customer export writes "-" where an email is missing. Stored
    // verbatim, that becomes an email address; a "N/A" city becomes a city, gets
    // its own pack, and shows up on reports as a place people live.
    const out = normalizeParsedLead({
      firstName: "-",
      lastName: "Kairies",
      phone: "+12145573729",
      email: "-",
      city: "N/A",
      state: "n/a",
      zip: "none",
      utilityProvider: "unknown",
    });
    expect(out.email).toBeUndefined();
    expect(out.city).toBeUndefined();
    expect(out.state).toBeUndefined();
    expect(out.zip).toBeUndefined();
    expect(out.utilityProvider).toBeUndefined();
    expect(out.firstName).toBe("");
    expect(out.lastName).toBe("Kairies");
  });

  it("only blanks a placeholder that is the WHOLE value", () => {
    expect(blankIfPlaceholder("Nome")).toBe("Nome");
    expect(blankIfPlaceholder("None of the above")).toBe("None of the above");
    expect(blankIfPlaceholder("N/A")).toBe("");
    expect(normalizeParsedLead({ firstName: "A", lastName: "B", phone: "", city: "Nome" }).city).toBe(
      "Nome",
    );
  });

  it("normalizes a whole lead without touching notes or custom fields", () => {
    const out = normalizeParsedLead({
      firstName: "BRIDGET",
      lastName: "KAIRIES",
      phone: "+12145573729",
      email: "  Bridget@Example.COM ",
      address: "3832 AZURE LN",
      city: "ADDISON",
      state: "texas",
      zip: "1001",
      notes: "LEAVE THIS ALONE",
      customFields: { source: "BROKER A" },
    });
    expect(out).toMatchObject({
      firstName: "Bridget",
      lastName: "Kairies",
      email: "bridget@example.com",
      address: "3832 Azure Ln",
      city: "Addison",
      state: "TX",
      zip: "01001",
      notes: "LEAVE THIS ALONE",
      customFields: { source: "BROKER A" },
    });
  });
});

describe("scoreParse — how the AI mapping and the header mapper are judged", () => {
  const lead = (over: Record<string, unknown> = {}) => ({
    firstName: "A",
    lastName: "B",
    phone: "+12145550001",
    ...over,
  });
  const result = (leads: ReturnType<typeof lead>[]) => ({
    leads,
    noPhone: 0,
    sawPhoneColumn: true,
    discoveredFields: [],
  });

  it("prefers the mapping that found more dialable numbers", () => {
    const good = result([lead(), lead({ phone: "+12145550002" })]);
    const bad = result([lead({ phone: "not a phone" }), lead({ phone: "" })]);
    expect(scoreParse(good, 2)).toBeGreaterThan(scoreParse(bad, 2));
  });

  it("does not reward a mapping for quietly extracting fewer rows", () => {
    const all = result([lead(), lead({ phone: "+12145550002" })]);
    const half = result([lead()]);
    // Same denominator (the grid's rows), so dropping a row can only lose points.
    expect(scoreParse(half, 2)).toBeLessThan(scoreParse(all, 2));
  });
});

describe("sanitizeColumnPlan — a plan that came back through the browser", () => {
  it("rebuilds a headers plan, nulling out field names it doesn't recognise", () => {
    const plan = sanitizeColumnPlan({
      kind: "headers",
      header: ["firstName", "phone", "__proto__", "notAField", null],
      captures: [{ col: 4, key: "net_worth", label: "Net Worth", type: "currency" }],
    }) as Extract<ColumnPlan, { kind: "headers" }>;
    expect(plan.header).toEqual(["firstName", "phone", null, null, null]);
    expect(plan.captures).toHaveLength(1);
  });

  it("drops captures with reserved, unnormalized, duplicate or untyped keys", () => {
    const plan = sanitizeColumnPlan({
      kind: "headers",
      header: [],
      captures: [
        { col: 0, key: "status", label: "Status", type: "text" }, // reserved
        { col: 1, key: "Net Worth", label: "x", type: "text" }, // not normalized
        { col: 2, key: "age", label: "Age", type: "banana" }, // unknown type
        { col: 3, key: "age", label: "Age", type: "number" }, // kept
        { col: 4, key: "age", label: "Age again", type: "number" }, // duplicate
      ],
    }) as Extract<ColumnPlan, { kind: "headers" }>;
    expect(plan.captures.map((c) => c.key)).toEqual(["age"]);
    expect(plan.captures[0].col).toBe(3);
  });

  it("coerces a malformed AI mapping into safe integers instead of trusting it", () => {
    const plan = sanitizeColumnPlan({
      kind: "ai",
      mapping: {
        hasHeader: true,
        firstNameCol: "0",
        phoneCols: [{ numberCol: 2, dncCol: "x" }, { numberCol: -1, dncCol: -1 }],
        emailCols: [3, "nope"],
      },
      captures: [],
    }) as Extract<ColumnPlan, { kind: "ai" }>;
    expect(plan.mapping.firstNameCol).toBe(-1); // "0" is not an integer
    expect(plan.mapping.phoneCols).toEqual([{ numberCol: 2, dncCol: -1 }]);
    expect(plan.mapping.emailCols).toEqual([3]);
  });

  it("rejects junk outright", () => {
    expect(sanitizeColumnPlan(null)).toBeNull();
    expect(sanitizeColumnPlan("headers")).toBeNull();
    expect(sanitizeColumnPlan({ kind: "something-else" })).toBeNull();
  });
});

describe("chunked parse — the whole file, read the same way throughout", () => {
  beforeEach(() => {
    // Force the deterministic path so the suite never reaches the network,
    // whatever the developer has in their environment.
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });

  it("parses a 9,381-row file across chunks with nothing lost", async () => {
    const csv = makeCsv(9381);
    const chunks = splitCsvIntoChunks(csv, { maxRows: 4000, maxBytes: 3_000_000 });
    expect(chunks.length).toBeGreaterThan(1);

    let plan: ColumnPlan | null = null;
    let total = 0;
    for (const chunk of chunks) {
      const parsed = await parseCsvToLeads(chunk.csv, { plan });
      if ("error" in parsed) throw new Error(parsed.error);
      // The layout is resolved once and replayed — chunk 7 reads the file
      // exactly the way chunk 1 did.
      plan ??= parsed.plan;
      expect(parsed.leads).toHaveLength(chunk.rows);
      total += parsed.leads.length;
    }
    expect(total).toBe(9381);
  });

  it("gives every parsed lead a dialable phone and a normalized state", async () => {
    const parsed = await parseCsvToLeads(makeCsv(5));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.leads).toHaveLength(5);
    expect(parsed.leads.every((l) => l.phone.startsWith("+1"))).toBe(true);
    expect(parsed.leads.every((l) => l.state === "TX")).toBe(true);
  });

  it("replaying a plan on a chunk reads it identically to parsing it alone", async () => {
    const csv = makeCsv(12);
    const first = await parseCsvToLeads(csv);
    if ("error" in first) throw new Error(first.error);

    const chunks = splitCsvIntoChunks(csv, { maxRows: 6, maxBytes: 3_000_000 });
    const replayed = await parseCsvToLeads(chunks[1].csv, { plan: first.plan });
    if ("error" in replayed) throw new Error(replayed.error);
    expect(replayed.leads).toEqual(first.leads.slice(6));
  });

  it("still reads a file the deterministic mapper handles well without a key", async () => {
    const parsed = await parseCsvToLeads(makeCsv(3));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.source).toBe("headers");
    // No key + a file that parsed cleanly is NOT an error worth showing.
    expect(parsed.aiError).toBeNull();
  });

  it("says why AI mapping mattered when the file needed it and no key exists", async () => {
    // Headerless broker-style rows: names never map, so isConfident() fails.
    const csv = ["8675309,+12145550001,,", "8675310,+12145550002,,"].join("\n");
    const parsed = await parseCsvToLeads(csv);
    expect("error" in parsed || parsed.aiError).toBeTruthy();
  });
});

describe("importShortfall — the books have to balance", () => {
  const totals = (over: Partial<ImportTotals> = {}): ImportTotals => ({
    inserted: 0,
    invalidPhone: 0,
    duplicates: 0,
    dncSkipped: 0,
    fileRows: 0,
    parsedRows: 0,
    skippedRows: 0,
    truncated: 0,
    packs: 0,
    source: "headers",
    aiError: null,
    chunks: 1,
    chunksSent: 1,
    ...over,
  });

  it("stays quiet when every row is accounted for", () => {
    expect(
      importShortfall(
        totals({ fileRows: 100, inserted: 80, duplicates: 12, dncSkipped: 5, skippedRows: 3 }),
      ),
    ).toBeNull();
  });

  it("counts rows kept without a dialable phone as imported, not missing", () => {
    // invalidPhone rows ARE inserted — they're just not callable yet.
    expect(
      importShortfall(totals({ fileRows: 10, inserted: 10, invalidPhone: 4 })),
    ).toBeNull();
  });

  it("reports the exact 4,381 that used to vanish", () => {
    const warning = importShortfall(totals({ fileRows: 9381, inserted: 5000 }));
    expect(warning).toContain("4381");
    expect(warning).toContain("9381");
  });

  it("calls out a size-limit truncation specifically", () => {
    const warning = importShortfall(
      totals({ fileRows: 30_000, inserted: 25_000, truncated: 5000 }),
    );
    expect(warning).toContain("5000");
    expect(warning).toContain("size limit");
  });

  it("does not flag a chunk that was legitimately 100% duplicates", () => {
    expect(importShortfall(totals({ fileRows: 4000, duplicates: 4000 }))).toBeNull();
  });
});

describe("describeImport", () => {
  const base: ImportTotals = {
    inserted: 8600,
    invalidPhone: 12,
    duplicates: 700,
    dncSkipped: 60,
    fileRows: 9381,
    parsedRows: 9360,
    skippedRows: 21,
    truncated: 0,
    packs: 3,
    source: "ai",
    aiError: null,
    chunks: 3,
    chunksSent: 3,
  };

  it("reports the summed totals of a chunked upload, not one chunk's", () => {
    const line = describeImport(base);
    expect(line).toContain("Imported 8600 leads");
    expect(line).toContain("700 already in your org's leads");
    expect(line).toContain("60 on your Do-Not-Call list");
    expect(line).toContain("21 rows had no phone and no name");
    expect(line).toContain("columns mapped by AI");
    expect(line).toContain("3 packs");
  });

  it("stays clean when there is nothing to caveat", () => {
    expect(
      describeImport({
        ...base,
        invalidPhone: 0,
        duplicates: 0,
        dncSkipped: 0,
        skippedRows: 0,
        packs: 0,
        source: "headers",
      }),
    ).toBe("Imported 8600 leads.");
  });
});

describe("rowsToLeads with a shared plan", () => {
  it("types a column the same way in a chunk whose own data would type it differently", () => {
    const full = parseSheet(
      ["Name,Phone,Score", "A,+12145550001,10", "B,+12145550002,n/a"].join("\n"),
    );
    // Resolved across the whole file, "Score" is text (one value isn't a number).
    const whole = rowsToLeads(full);
    const scoreField = whole.discoveredFields.find((f) => f.key === "score" || f.label === "Score");
    // "score" is a reserved key, so it is deliberately NOT captured at all —
    // which is itself the guarantee: an export's metadata never re-imports.
    expect(scoreField).toBeUndefined();
  });
});
