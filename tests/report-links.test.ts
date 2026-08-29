import { describe, expect, it } from "vitest";
import {
  decodeFilterParam,
  encodeFilterParam,
  sanitizeFilterSpec,
  type FilterSpec,
} from "@/lib/leads/filter-spec";
import {
  drillAppointments,
  drillConnected,
  drillDialed,
  drillHref,
  drillOutcome,
  drillRep,
} from "@/lib/reports/drill";
import { reportViewHref, sanitizeReportViews } from "@/lib/reports/view-spec";

// Every drill spec must be SANITIZE-STABLE: what the link encodes is exactly
// what /leads decodes and runs — no condition silently dropped, no kind
// re-stamped. If sanitize changes shape, the drilled set would quietly differ
// from the number the user clicked, which is the bug this file pins shut.

const roundTrips = (spec: FilterSpec) => {
  expect(sanitizeFilterSpec(spec)).toEqual(spec);
  const param = encodeFilterParam(spec);
  expect(param).not.toBe("");
  expect(decodeFilterParam(param)).toEqual(spec);
};

describe("drill FilterSpecs are sanitize-stable", () => {
  it("drillDialed — ranged and all-time", () => {
    roundTrips(drillDialed(7));
    roundTrips(drillDialed(1));
    roundTrips(drillDialed(null));
  });

  it("drillConnected", () => {
    roundTrips(drillConnected(30));
    roundTrips(drillConnected(null));
  });

  it("drillOutcome for every stored outcome key", () => {
    for (const key of [
      "appointment_booked",
      "callback_scheduled",
      "qualified",
      "not_interested",
      "bills_fine",
      "voicemail",
      "no_answer",
      "wrong_number",
      "do_not_call",
    ]) {
      roundTrips(drillOutcome(key, 7));
      roundTrips(drillOutcome(key, null));
    }
  });

  it("drillAppointments + drillRep", () => {
    roundTrips(drillAppointments());
    roundTrips(drillRep("2f5a6c2e-1111-4222-8333-444455556666"));
  });

  it("drillHref points at /leads with the encoded param", () => {
    const spec = drillDialed(7);
    const href = drillHref(spec);
    expect(href.startsWith("/leads?f=")).toBe(true);
    expect(decodeFilterParam(href.slice("/leads?f=".length))).toEqual(spec);
  });

  it("range conditions are omitted (not emitted empty) for all-time", () => {
    const spec = drillDialed(null);
    expect(spec.groups[0].conditions).toHaveLength(1);
    expect(spec.groups[0].conditions[0]).toMatchObject({ key: "attempt_count" });
  });
});

describe("saved report views (view-spec)", () => {
  it("sanitizes garbage down to the valid views and caps at 12", () => {
    const raw = [
      { id: "a", name: "Weekly compare", config: { range: "7d", compare: "prev" } },
      { id: "b", name: "Bad range", config: { range: "yesterday", compare: "none" } },
      { id: "a", name: "Duplicate id", config: { range: "30d", compare: "none" } },
      { id: "c", name: "", config: { range: "30d", compare: "none" } },
      "not-an-object",
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `x${i}`,
        name: `View ${i}`,
        config: { range: "today", compare: "none" },
      })),
    ];
    const views = sanitizeReportViews(raw);
    expect(views).toHaveLength(12);
    expect(views[0]).toEqual({
      id: "a",
      name: "Weekly compare",
      config: { range: "7d", compare: "prev" },
    });
    expect(views.some((v) => v.id === "b" || v.name === "")).toBe(false);
  });

  it("reportViewHref omits defaults", () => {
    expect(reportViewHref({ range: "all", compare: "none" })).toBe("/reports");
    expect(reportViewHref({ range: "7d", compare: "prev" })).toBe(
      "/reports?range=7d&compare=prev",
    );
  });
});
