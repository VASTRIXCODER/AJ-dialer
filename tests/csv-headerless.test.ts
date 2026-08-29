import { beforeEach, describe, expect, it, vi } from "vitest";
import { splitCsvIntoChunks } from "@/lib/leads/chunk";
import {
  guessHasHeader,
  parseSheet,
  resolveHeaderPlan,
  rowsToLeads,
} from "@/lib/leads/csv";
import { parseCsvToLeads, type ColumnPlan } from "@/lib/leads/parse-request";

// ─────────────────────────────────────────────────────────────────────────────
// F8: a headerless broker list lost row 1 at TWO independent layers — csv.ts
// consumed it as column names, and chunk.ts lifted records[0] as the header of
// every chunk. Both self-consistently mis-counted, so the shortfall report
// balanced. These tests pin the fix: with hasHeader:false, row 0 is DATA at
// every layer, and NOTHING may ever consume it.
// ─────────────────────────────────────────────────────────────────────────────

/** A headerless broker-style file: id, phone, city, zip — no column names. */
function makeHeaderless(n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const line = String(i).padStart(7, "0");
    return `86753${i},+1214${line},Dallas,75001`;
  }).join("\n");
}

beforeEach(() => {
  // Force the deterministic path — the suite never reaches the network.
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

describe("guessHasHeader — presets the toggle, never silently decides", () => {
  it("says header when row 0 maps at least two core fields by name", () => {
    const grid = parseSheet("First Name,Last Name,Phone\nA,B,+12145550001");
    expect(guessHasHeader(grid)).toBe(true);
  });

  it("says headerless for broker rows that are all data", () => {
    const grid = parseSheet(makeHeaderless(5));
    expect(guessHasHeader(grid)).toBe(false);
  });

  it("says header when row 0 is the ONLY row with no digits", () => {
    // Column names mapHeader can't map at all — the digit heuristic decides.
    const grid = parseSheet(
      ["person,dialstring,locality", "A,+12145550001,Dallas", "B,+12145550002,Plano"].join("\n"),
    );
    expect(guessHasHeader(grid)).toBe(true);
  });

  it("does not call a digit-carrying first row a header", () => {
    const grid = parseSheet(["A,+12145550001,Dallas", "B,+12145550002,Plano"].join("\n"));
    expect(guessHasHeader(grid)).toBe(false);
  });
});

describe("rowsToLeads with hasHeader:false — row 0 is a lead", () => {
  it("keeps every row including row 0", () => {
    const grid = parseSheet(makeHeaderless(10));
    const plan = resolveHeaderPlan(grid, { hasHeader: false });
    const result = rowsToLeads(grid, plan);
    expect(result.leads).toHaveLength(10);
    // Row 0's phone is present — the exact lead the old path ate.
    expect(result.leads[0].phone).toBe("+12140000000");
  });

  it("sniffs the phone column from the data starting at row 0", () => {
    const grid = parseSheet(makeHeaderless(3));
    const plan = resolveHeaderPlan(grid, { hasHeader: false });
    expect(plan.header[1]).toBe("phone");
    expect(plan.hasHeader).toBe(false);
  });

  it("captures unmapped columns under synthetic column_n keys", () => {
    const grid = parseSheet(makeHeaderless(3));
    const plan = resolveHeaderPlan(grid, { hasHeader: false });
    const keys = plan.captures.map((c) => c.key);
    expect(keys).toContain("column_1"); // the broker-id column
    expect(keys).not.toContain("column_2"); // the phone column is mapped, not captured
    const labels = plan.captures.map((c) => c.label);
    expect(labels).toContain("Column 1");
  });

  it("still consumes row 0 as headers when hasHeader is true (unchanged path)", () => {
    const grid = parseSheet("First,Last,Phone\nA,B,+12145550001");
    const result = rowsToLeads(grid, resolveHeaderPlan(grid));
    expect(result.leads).toHaveLength(1);
  });
});

describe("splitCsvIntoChunks with hasHeader:false — no record lifted", () => {
  it("chunks 3N rows into offsets 0 / N / 2N with every record intact", () => {
    const csv = makeHeaderless(12);
    const chunks = splitCsvIntoChunks(csv, {
      maxRows: 4,
      maxBytes: 3_000_000,
      hasHeader: false,
    });
    expect(chunks.map((c) => c.rows)).toEqual([4, 4, 4]);
    expect(chunks.map((c) => c.rowOffset)).toEqual([0, 4, 8]);
    // NO header line: every line of every chunk is a data record.
    const allRows = chunks.flatMap((c) => c.csv.split("\n"));
    expect(allRows).toEqual(csv.split("\n"));
  });

  it("round-trips through parseCsvToLeads with the total preserved", async () => {
    const csv = makeHeaderless(12);
    const chunks = splitCsvIntoChunks(csv, {
      maxRows: 4,
      maxBytes: 3_000_000,
      hasHeader: false,
    });
    // Resolve the plan once (chunk 1) and replay it — exactly what the client does.
    let plan: ColumnPlan | null = null;
    let total = 0;
    for (const chunk of chunks) {
      const parsed = await parseCsvToLeads(chunk.csv, {
        plan,
        hasHeader: false,
      });
      if ("error" in parsed) throw new Error(parsed.error);
      plan ??= parsed.plan;
      expect(parsed.leads).toHaveLength(chunk.rows);
      total += parsed.leads.length;
    }
    expect(total).toBe(12);
  });

  it("imports the single-row headerless file as one lead", async () => {
    const csv = "8675309,+12145550001,Dallas,75001";
    const chunks = splitCsvIntoChunks(csv, {
      maxRows: 4000,
      maxBytes: 3_000_000,
      hasHeader: false,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].rows).toBe(1);
    const parsed = await parseCsvToLeads(chunks[0].csv, { hasHeader: false });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.leads).toHaveLength(1);
    expect(parsed.leads[0].phone).toBe("+12145550001");
  });

  it("never cuts inside a quoted field spanning a chunk boundary", () => {
    const csv = [
      '"12 Main St\nApt 4",+12145550001,Dallas',
      "13 Main St,+12145550002,Plano",
    ].join("\n");
    const chunks = splitCsvIntoChunks(csv, {
      maxRows: 1,
      maxBytes: 3_000_000,
      hasHeader: false,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].csv).toContain("12 Main St\nApt 4");
    expect(chunks[0].rows).toBe(1);
    expect(chunks[1].rowOffset).toBe(1);
  });

  it("headers mode still lifts the header for every chunk (unchanged path)", () => {
    const csv = ["Name,Phone", "A,+12145550001", "B,+12145550002"].join("\n");
    const chunks = splitCsvIntoChunks(csv, { maxRows: 1, maxBytes: 3_000_000 });
    expect(chunks).toHaveLength(2);
    for (const c of chunks) expect(c.csv.split("\n")[0]).toBe("Name,Phone");
  });
});

describe("the plan itself carries hasHeader across chunks", () => {
  it("a replayed headers plan with hasHeader:false reads row 0 as data", async () => {
    const csv = makeHeaderless(6);
    const first = await parseCsvToLeads(csv, { hasHeader: false });
    if ("error" in first) throw new Error(first.error);
    expect(first.leads).toHaveLength(6);
    expect(first.fileRows).toBe(6);
    expect(first.skippedRows).toBe(0);

    // A later chunk parsed under the SAME plan — no hasHeader argument needed,
    // the plan remembers.
    const chunk2 = makeHeaderless(3);
    const replayed = await parseCsvToLeads(chunk2, { plan: first.plan });
    if ("error" in replayed) throw new Error(replayed.error);
    expect(replayed.leads).toHaveLength(3);
  });
});
