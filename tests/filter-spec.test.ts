import { describe, expect, it } from "vitest";
import {
  decodeFilterParam,
  encodeFilterParam,
  sanitizeFilterSpec,
} from "@/lib/leads/filter-spec";
import type { FilterCondition, FilterSpec } from "@/lib/leads/filter-spec";

// Shorthand: a spec of one AND group around the given conditions.
const one = (...conditions: unknown[]) => ({
  op: "and",
  groups: [{ op: "and", conditions }],
});

const cond = (key: string, cmp: string, value?: unknown) => ({
  kind: "core",
  key,
  cmp,
  ...(value === undefined ? {} : { value }),
});

describe("sanitizeFilterSpec", () => {
  it("accepts a well-formed spec and normalizes kind per key", () => {
    const spec = sanitizeFilterSpec(
      one(cond("city", "eq", "Fresno"), cond("archived", "is_false")),
    );
    expect(spec).not.toBeNull();
    expect(spec!.groups[0].conditions).toEqual([
      { kind: "core", key: "city", cmp: "eq", value: "Fresno" },
      { kind: "derived", key: "archived", cmp: "is_false" },
    ]);
  });

  it("rejects non-object and structurally broken input", () => {
    expect(sanitizeFilterSpec(null)).toBeNull();
    expect(sanitizeFilterSpec("city=Fresno")).toBeNull();
    expect(sanitizeFilterSpec([])).toBeNull();
    expect(sanitizeFilterSpec({ op: "and" })).toBeNull();
    expect(sanitizeFilterSpec({ op: "and", groups: "nope" })).toBeNull();
  });

  it("drops conditions with unknown keys, nulling out an all-invalid spec", () => {
    expect(sanitizeFilterSpec(one(cond("hacker_field", "eq", "x")))).toBeNull();
    // A mix keeps the valid condition and sheds the junk.
    const spec = sanitizeFilterSpec(
      one(cond("hacker_field", "eq", "x"), cond("state", "eq", "CA")),
    );
    expect(spec!.groups[0].conditions).toEqual([
      { kind: "core", key: "state", cmp: "eq", value: "CA" },
    ]);
  });

  it("drops cmp/type mismatches for every family", () => {
    // contains on a number, is_true on text, within_days on a number,
    // gt on a date, contains on an enum (stored keys are not prose).
    expect(sanitizeFilterSpec(one(cond("utility_bill", "contains", "1")))).toBeNull();
    expect(sanitizeFilterSpec(one(cond("city", "is_true")))).toBeNull();
    expect(sanitizeFilterSpec(one(cond("attempt_count", "within_days", 7)))).toBeNull();
    expect(sanitizeFilterSpec(one(cond("created_at", "gt", 5)))).toBeNull();
    expect(sanitizeFilterSpec(one(cond("status", "contains", "fine")))).toBeNull();
  });

  it("drops values of the wrong shape for the cmp", () => {
    expect(sanitizeFilterSpec(one(cond("utility_bill", "gt", "200")))).toBeNull();
    expect(sanitizeFilterSpec(one(cond("utility_bill", "between", [1])))).toBeNull();
    expect(sanitizeFilterSpec(one(cond("status", "in", "new")))).toBeNull();
    expect(sanitizeFilterSpec(one(cond("status", "in", [])))).toBeNull();
    expect(sanitizeFilterSpec(one(cond("created_at", "before", "not a date")))).toBeNull();
    expect(sanitizeFilterSpec(one(cond("last_attempt_at", "within_days", -3)))).toBeNull();
  });

  it("strips stray values from valueless comparators", () => {
    const spec = sanitizeFilterSpec(one(cond("has_ev", "is_true", "surprise")));
    expect(spec!.groups[0].conditions).toEqual([
      { kind: "core", key: "has_ev", cmp: "is_true" },
    ]);
  });

  it("caps groups at 8", () => {
    const raw = {
      op: "or",
      groups: Array.from({ length: 12 }, () => ({
        op: "and",
        conditions: [cond("city", "eq", "Fresno")],
      })),
    };
    expect(sanitizeFilterSpec(raw)!.groups).toHaveLength(8);
  });

  it("caps conditions at 8 per group", () => {
    const raw = one(...Array.from({ length: 12 }, () => cond("city", "eq", "Fresno")));
    expect(sanitizeFilterSpec(raw)!.groups[0].conditions).toHaveLength(8);
  });

  it("rejects custom keys that are not their own normalization", () => {
    const custom = (key: string): unknown => ({
      kind: "custom", key, type: "number", cmp: "gt", value: 100,
    });
    expect(sanitizeFilterSpec(one(custom("Policy Premium")))).toBeNull();
    expect(sanitizeFilterSpec(one(custom("policy__premium")))).toBeNull();
    expect(sanitizeFilterSpec(one(custom("premium_")))).toBeNull();
    // The normalized form sails through.
    const ok = sanitizeFilterSpec(one(custom("policy_premium")));
    expect(ok!.groups[0].conditions).toEqual([
      { kind: "custom", key: "policy_premium", type: "number", cmp: "gt", value: 100 },
    ]);
  });

  it("rejects custom conditions with unknown field types", () => {
    expect(
      sanitizeFilterSpec(
        one({ kind: "custom", key: "premium", type: "jsonb", cmp: "eq", value: "x" }),
      ),
    ).toBeNull();
  });

  it("enforces cmp whitelists per custom field type", () => {
    expect(
      sanitizeFilterSpec(
        one({ kind: "custom", key: "premium", type: "currency", cmp: "contains", value: "1" }),
      ),
    ).toBeNull();
    expect(
      sanitizeFilterSpec(
        one({ kind: "custom", key: "active", type: "boolean", cmp: "eq", value: "yes" }),
      ),
    ).toBeNull();
  });

  it("drops oversized string and array values", () => {
    expect(sanitizeFilterSpec(one(cond("city", "eq", "x".repeat(201))))).toBeNull();
    expect(
      sanitizeFilterSpec(one(cond("status", "in", Array.from({ length: 51 }, () => "new")))),
    ).toBeNull();
    expect(
      sanitizeFilterSpec(one(cond("status", "in", ["new", "x".repeat(201)]))),
    ).toBeNull();
    // At the caps, everything is fine.
    const ok = sanitizeFilterSpec(
      one(
        cond("city", "eq", "x".repeat(200)),
        cond("status", "in", Array.from({ length: 50 }, () => "new")),
      ),
    );
    expect(ok!.groups[0].conditions).toHaveLength(2);
  });

  it("drops empty groups and unknown group shapes", () => {
    const spec = sanitizeFilterSpec({
      op: "and",
      groups: [
        { op: "and", conditions: [] },
        "junk",
        { op: "or", conditions: [cond("zip", "starts_with", "937")] },
      ],
    });
    expect(spec!.groups).toHaveLength(1);
    expect(spec!.groups[0].op).toBe("or");
  });

  it("defaults unrecognized ops to and", () => {
    const spec = sanitizeFilterSpec({
      op: "xor",
      groups: [{ op: "nand", conditions: [cond("city", "eq", "Fresno")] }],
    });
    expect(spec!.op).toBe("and");
    expect(spec!.groups[0].op).toBe("and");
  });
});

describe("encodeFilterParam / decodeFilterParam", () => {
  const roundtripSpec: FilterSpec = {
    op: "or",
    groups: [
      {
        op: "and",
        conditions: [
          { kind: "core", key: "city", cmp: "eq", value: "Fresno" },
          { kind: "core", key: "utility_bill", cmp: "between", value: [150, 300] },
          { kind: "derived", key: "never_dialed", cmp: "is_true" },
        ] as FilterCondition[],
      },
      {
        op: "or",
        conditions: [
          { kind: "custom", key: "policy_premium", type: "currency", cmp: "gte", value: 200 },
          { kind: "core", key: "status", cmp: "in", value: ["new", "callback"] },
        ] as FilterCondition[],
      },
    ],
  };

  it("roundtrips a spec through the URL param unchanged", () => {
    const param = encodeFilterParam(roundtripSpec);
    expect(param.length).toBeGreaterThan(0);
    // base64url only — safe to drop straight into a query string.
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeFilterParam(param)).toEqual(roundtripSpec);
  });

  it("returns '' when the encoded spec exceeds the param budget", () => {
    const huge: FilterSpec = {
      op: "and",
      groups: Array.from({ length: 8 }, () => ({
        op: "and" as const,
        conditions: Array.from({ length: 8 }, (): FilterCondition => ({
          kind: "core",
          key: "status",
          cmp: "in",
          value: Array.from({ length: 50 }, (_, i) => `key_${i}_${"x".repeat(30)}`),
        })),
      })),
    };
    expect(encodeFilterParam(huge)).toBe("");
  });

  it("returns null for garbage params instead of throwing", () => {
    expect(decodeFilterParam("")).toBeNull();
    expect(decodeFilterParam("!!!not-base64url!!!")).toBeNull();
    expect(decodeFilterParam("x".repeat(5000))).toBeNull();
    // Valid base64url of JSON that sanitizes to nothing is still null.
    const emptyish = encodeFilterParam({ op: "and", groups: [] });
    expect(decodeFilterParam(emptyish)).toBeNull();
  });

  it("sanitizes on decode — a tampered param cannot smuggle junk conditions", () => {
    const tampered = Buffer.from(
      JSON.stringify({
        op: "and",
        groups: [
          {
            op: "and",
            conditions: [
              { kind: "core", key: "city", cmp: "eq", value: "Fresno" },
              { kind: "core", key: "__proto__", cmp: "eq", value: "boom" },
            ],
          },
        ],
      }),
      "utf8",
    ).toString("base64url");
    const spec = decodeFilterParam(tampered);
    expect(spec!.groups[0].conditions).toEqual([
      { kind: "core", key: "city", cmp: "eq", value: "Fresno" },
    ]);
  });
});
