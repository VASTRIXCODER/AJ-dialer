import { describe, expect, it } from "vitest";
import {
  decideImportAction,
  type DedupeMode,
  type ImportAction,
} from "@/lib/db/lead-import";

// ─────────────────────────────────────────────────────────────────────────────
// The skip / update / create_new decision matrix — pure, so the whole thing is
// pinned without a database. The probe fixture stands in for app_phone_matches:
// digits → the lead id that already carries that number in the org.
// ─────────────────────────────────────────────────────────────────────────────

const PROBE = new Map<string, string>([
  ["2145550001", "lead-a"],
  ["2145550002", "lead-b"],
]);

function decide(
  digits: string,
  mode: DedupeMode,
  seenInBatch = false,
): ImportAction {
  return decideImportAction({
    digits,
    existingLeadId: PROBE.get(digits) ?? null,
    seenInBatch,
    mode,
  });
}

describe("decideImportAction — the full matrix", () => {
  it("skip: existing number ⇒ skip, new number ⇒ create", () => {
    expect(decide("2145550001", "skip")).toBe("skip");
    expect(decide("2145559999", "skip")).toBe("create");
  });

  it("skip: an in-batch repeat is a duplicate", () => {
    expect(decide("2145559999", "skip", true)).toBe("skip");
  });

  it("update: existing number ⇒ update, new number ⇒ create", () => {
    expect(decide("2145550001", "update")).toBe("update");
    expect(decide("2145559999", "update")).toBe("create");
  });

  it("update: an in-batch repeat with no existing row is a duplicate", () => {
    expect(decide("2145559999", "update", true)).toBe("skip");
  });

  it("create_new: everything creates, even known numbers", () => {
    expect(decide("2145550001", "create_new")).toBe("create");
    expect(decide("2145559999", "create_new")).toBe("create");
    expect(decide("2145559999", "create_new", true)).toBe("create");
  });

  it("no usable digits ⇒ create in every mode (nothing to dedupe on)", () => {
    for (const mode of ["skip", "update", "create_new"] as DedupeMode[]) {
      expect(decide("", mode)).toBe("create");
      expect(decide("555", mode)).toBe("create");
    }
  });
});

describe("idempotent retry — replaying a landed chunk creates nothing", () => {
  /** Run a chunk of digits through the decision loop the way writeImportChunk does. */
  function runChunk(
    digits: string[],
    probe: Map<string, string>,
    mode: DedupeMode,
  ): { created: string[]; updated: number; skipped: number } {
    const seen = new Set<string>();
    const created: string[] = [];
    let updated = 0;
    let skipped = 0;
    for (const d of digits) {
      const action = decideImportAction({
        digits: d,
        existingLeadId: probe.get(d) ?? null,
        seenInBatch: seen.has(d),
        mode,
      });
      if (d.length === 10) seen.add(d);
      if (action === "create") created.push(d);
      else if (action === "update") updated++;
      else skipped++;
    }
    return { created, updated, skipped };
  }

  const chunk = ["2145551000", "2145551001", "2145551002", "2145551001"];

  it("skip mode: the retry finds every digit in the probe and creates zero", () => {
    const first = runChunk(chunk, new Map(), "skip");
    expect(first.created).toEqual(["2145551000", "2145551001", "2145551002"]);
    expect(first.skipped).toBe(1); // the in-batch repeat

    // The first pass landed — the probe now knows every number.
    const probe = new Map(first.created.map((d, i) => [d, `lead-${i}`]));
    const retry = runChunk(chunk, probe, "skip");
    expect(retry.created).toHaveLength(0);
    expect(retry.skipped).toBe(4);
  });

  it("update mode: the retry updates instead of creating", () => {
    const first = runChunk(chunk, new Map(), "update");
    expect(first.created).toHaveLength(3);

    const probe = new Map(first.created.map((d, i) => [d, `lead-${i}`]));
    const retry = runChunk(chunk, probe, "update");
    expect(retry.created).toHaveLength(0);
    expect(retry.updated).toBe(4); // per-row decision; writeImportChunk collapses repeats
  });
});
